import mongoose, { type ClientSession, type Types } from "mongoose";
import { connectDB } from "../db/connect";
import {
  AllocationAudit,
  FundingAllocation,
  Transaction,
  User,
  oid,
} from "../db/models";
import { allocateFifo, type FundingConsumer, type FundingSource } from "./fifo";
import { InsufficientFundsError } from "../errors";
import { formatDate } from "../dates";
import { formatTaka } from "../money";
import { CONSUMER_TYPES, SOURCE_TYPES, affectsFunding, isConsumer, isSource } from "./model";
export { CONSUMER_TYPES, SOURCE_TYPES, affectsFunding, isConsumer, isSource };

/** Earliest possible date: recomputing from here rebuilds the whole funding ledger. */
export const LEDGER_START = "0000-01-01";

/**
 * Run `fn` inside a MongoDB transaction that also bumps the user's ledgerVersion.
 * Every ledger write touches that same user document, so concurrent ledger writes
 * for one user conflict and are retried serially instead of interleaving.
 */
export async function withLedger<T>(userId: string, fn: (session: ClientSession) => Promise<T>): Promise<T> {
  await connectDB();
  return mongoose.connection.transaction(async (session) => {
    await User.updateOne({ _id: oid(userId) }, { $inc: { ledgerVersion: 1 } }, { session });
    return fn(session);
  });
}

type AllocKey = { sourceId: Types.ObjectId; amount: number };

function sameAllocations(a: AllocKey[], b: AllocKey[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (list: AllocKey[]) =>
    list.map((x) => `${x.sourceId.toString()}:${x.amount}`).sort().join("|");
  return norm(a) === norm(b);
}

/**
 * Rebuild FIFO funding allocations for every consumer dated on/after `fromDate`.
 *
 * Correctness of the window: any change to a source or consumer passes
 * fromDate = min(old date, new date). Consumers before that date could only ever have
 * drawn from sources dated before it, which the change did not touch — so their
 * allocations stay valid and are counted as "already used".
 *
 * Throws InsufficientFundsError (aborting the surrounding transaction) if any consumer
 * can no longer be fully funded.
 */
export async function recomputeFunding(
  userId: string,
  fromDate: string,
  session: ClientSession,
  opts: { reason: string; triggerId?: string },
): Promise<void> {
  const uid = oid(userId);

  const sourceDocs = await Transaction.find(
    { userId: uid, status: "paid", type: { $in: SOURCE_TYPES } },
    { date: 1, amount: 1, createdAt: 1 },
  )
    .session(session)
    .lean();

  const consumerDocs = await Transaction.find(
    { userId: uid, status: "paid", type: { $in: CONSUMER_TYPES }, date: { $gte: fromDate } },
    { date: 1, amount: 1, createdAt: 1, title: 1, fundingSourceId: 1 },
  )
    .session(session)
    .lean();

  const prior = await FundingAllocation.aggregate<{ _id: Types.ObjectId; used: number }>([
    { $match: { userId: uid, consumerDate: { $lt: fromDate } } },
    { $group: { _id: "$sourceId", used: { $sum: "$amount" } } },
  ]).session(session);

  const previous = await FundingAllocation.find(
    { userId: uid, consumerDate: { $gte: fromDate } },
    { consumerId: 1, sourceId: 1, amount: 1 },
  )
    .session(session)
    .lean();

  const sources: FundingSource[] = sourceDocs.map((s) => ({
    id: s._id.toString(),
    date: s.date,
    seq: s.createdAt.getTime(),
    amount: s.amount,
  }));
  const consumers: FundingConsumer[] = consumerDocs.map((c) => ({
    id: c._id.toString(),
    date: c.date,
    seq: c.createdAt.getTime(),
    amount: c.amount,
    preferredSourceId: c.fundingSourceId?.toString() ?? null,
  }));
  const alreadyUsed = new Map(prior.map((p) => [p._id.toString(), p.used]));

  const result = allocateFifo(sources, consumers, alreadyUsed);

  if (result.shortfalls.length > 0) {
    const s = result.shortfalls[0];
    const doc = consumerDocs.find((c) => c._id.toString() === s.consumerId);
    const isTrigger = s.consumerId === opts.triggerId;
    const what = isTrigger ? "This entry" : `“${doc?.title ?? "An expense"}” on ${formatDate(s.date)}`;
    throw new InsufficientFundsError(
      `Insufficient funds: ${what} needs ${formatTaka(s.required)} but only ${formatTaka(s.funded)} was available ` +
        `from salaries received by ${formatDate(s.date)}. Record the income first or reduce the amount.`,
      s,
    );
  }

  const sourceDate = new Map(sources.map((s) => [s.id, s.date]));
  const consumerDate = new Map(consumers.map((c) => [c.id, c.date]));

  await FundingAllocation.deleteMany({ userId: uid, consumerDate: { $gte: fromDate } }, { session });
  if (result.allocations.length > 0) {
    await FundingAllocation.insertMany(
      result.allocations.map((a) => ({
        userId: uid,
        consumerId: oid(a.consumerId),
        sourceId: oid(a.sourceId),
        amount: a.amount,
        consumerDate: consumerDate.get(a.consumerId)!,
        sourceDate: sourceDate.get(a.sourceId)!,
      })),
      { session },
    );
  }

  // Audit: record when an edit shifted funding of *other* existing expenses.
  const before = new Map<string, AllocKey[]>();
  for (const a of previous) {
    const k = a.consumerId.toString();
    if (!before.has(k)) before.set(k, []);
    before.get(k)!.push({ sourceId: a.sourceId, amount: a.amount });
  }
  const after = new Map<string, AllocKey[]>();
  for (const a of result.allocations) {
    if (!after.has(a.consumerId)) after.set(a.consumerId, []);
    after.get(a.consumerId)!.push({ sourceId: oid(a.sourceId), amount: a.amount });
  }
  const changes = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (id === opts.triggerId) continue;
    const b = before.get(id) ?? [];
    const a = after.get(id) ?? [];
    if (b.length === 0 || a.length === 0) continue; // creation/deletion of the consumer itself
    if (!sameAllocations(b, a)) changes.push({ consumerId: oid(id), before: b, after: a });
  }
  if (changes.length > 0) {
    await AllocationAudit.create([{ userId: uid, reason: opts.reason, fromDate, changes }], { session });
  }
}

export interface IntegrityReport {
  ok: boolean;
  problems: string[];
}

/** Independent check that the stored funding ledger is consistent with the transactions. */
export async function verifyFundingIntegrity(userId: string): Promise<IntegrityReport> {
  await connectDB();
  const uid = oid(userId);
  const [txns, allocs] = await Promise.all([
    Transaction.find({ userId: uid, status: "paid", type: { $in: [...SOURCE_TYPES, ...CONSUMER_TYPES] } }, { type: 1, amount: 1, date: 1, title: 1 }).lean(),
    FundingAllocation.find({ userId: uid }).lean(),
  ]);
  const problems: string[] = [];
  const byId = new Map(txns.map((t) => [t._id.toString(), t]));
  const consumed = new Map<string, number>();
  const funded = new Map<string, number>();
  for (const a of allocs) {
    const src = byId.get(a.sourceId.toString());
    const con = byId.get(a.consumerId.toString());
    if (!src || !SOURCE_TYPES.includes(src.type)) problems.push(`Allocation ${a._id} points to a missing income`);
    if (!con || !CONSUMER_TYPES.includes(con.type)) problems.push(`Allocation ${a._id} points to a missing expense`);
    if (src && con && src.date > con.date) problems.push(`“${con.title}” is funded by income received later`);
    consumed.set(a.sourceId.toString(), (consumed.get(a.sourceId.toString()) ?? 0) + a.amount);
    funded.set(a.consumerId.toString(), (funded.get(a.consumerId.toString()) ?? 0) + a.amount);
  }
  for (const t of txns) {
    const id = t._id.toString();
    if (SOURCE_TYPES.includes(t.type) && (consumed.get(id) ?? 0) > t.amount) {
      problems.push(`“${t.title}” is allocated beyond its amount`);
    }
    if (CONSUMER_TYPES.includes(t.type) && (funded.get(id) ?? 0) !== t.amount) {
      problems.push(`“${t.title}” (${formatDate(t.date)}) is funded ${formatTaka(funded.get(id) ?? 0)} of ${formatTaka(t.amount)}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
