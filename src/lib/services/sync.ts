import { createHash } from "node:crypto";
import { connectDB } from "../db/connect";
import { PersonAllocation, SavingsGoal, SyncOp, Transaction, User, oid, isObjectId } from "../db/models";
import { AppError } from "../errors";
import { getLookups } from "./lookups";
import { createTransaction, deleteTransaction, toTxnDTO, updateTransaction } from "./transactions";
import type { Snapshot, SyncOperation, SyncResult } from "../sync/types";

async function stampOf(txnId: string): Promise<string | null> {
  const t = await Transaction.findById(oid(txnId), { updatedAt: 1 }).lean();
  return t ? t.updatedAt.toISOString() : null;
}

/** Full copy of the user's data for the device. Small for a personal ledger; hashed so unchanged data isn't re-sent. */
export async function getSnapshot(userId: string): Promise<Snapshot> {
  await connectDB();
  const uid = oid(userId);
  const [user, lookups, allocations, goals, txns] = await Promise.all([
    User.findById(uid, { name: 1, email: 1 }).lean(),
    getLookups(userId),
    PersonAllocation.find({ userId: uid }).sort({ month: 1 }).lean(),
    SavingsGoal.find({ userId: uid }, { targetAmount: 1, monthlyTarget: 1 }).lean(),
    Transaction.find({ userId: uid }).sort({ date: 1, createdAt: 1, _id: 1 }).lean(),
  ]);
  if (!user) throw new AppError("Account not found");
  const body = {
    user: { id: userId, name: user.name, email: user.email },
    lookups,
    personAllocations: allocations.map((a) => ({ id: a._id.toString(), personId: a.personId.toString(), month: a.month, amount: a.amount, note: a.note ?? null })),
    goalTargets: goals.map((g) => ({ id: g._id.toString(), targetAmount: g.targetAmount, monthlyTarget: g.monthlyTarget })),
    transactions: txns.map((t) => toTxnDTO(t, lookups)),
  };
  const version = createHash("sha1").update(JSON.stringify(body)).digest("hex");
  return { version, serverTime: new Date().toISOString(), ...body };
}

/**
 * Apply one queued device change. Safe to repeat:
 *  - an opId already applied returns its stored result;
 *  - a create whose clientRef already exists returns that record (no duplicate);
 *  - an update already applied is recognised by lastOpId;
 *  - deleting a record that is already gone succeeds.
 * Edits never overwrite a record changed elsewhere since the device saw it (unless forced).
 * Business rules (FIFO funding, validation) are the server's own — exactly as online.
 */
export async function applyOperation(userId: string, op: SyncOperation): Promise<SyncResult> {
  await connectDB();
  const uid = oid(userId);
  const done = await SyncOp.findOne({ userId: uid, opId: op.opId }, { result: 1 }).lean();
  if (done) return done.result as unknown as SyncResult;

  const lookupsFor = async () => getLookups(userId);
  let result: SyncResult;
  try {
    if (op.kind === "create") {
      const existing = await Transaction.findOne({ userId: uid, clientRef: op.clientRef }, { _id: 1 }).lean();
      const txnId = existing ? existing._id.toString() : await createTransaction(userId, op.payload, { clientRef: op.clientRef });
      result = { opId: op.opId, status: "applied", txnId, updatedAt: await stampOf(txnId) };
    } else {
      if (!isObjectId(op.txnId)) throw new AppError("Invalid record reference");
      const existing = await Transaction.findOne({ _id: oid(op.txnId), userId: uid }).lean();
      if (op.kind === "update") {
        if (!existing) {
          return { opId: op.opId, status: "conflict", message: "This record was deleted on another device.", server: null };
        }
        if (existing.lastOpId === op.opId) {
          result = { opId: op.opId, status: "applied", txnId: op.txnId, updatedAt: existing.updatedAt.toISOString() };
        } else if (!op.force && existing.updatedAt.toISOString() !== op.baseUpdatedAt) {
          return {
            opId: op.opId,
            status: "conflict",
            message: "This record was changed on another device after you edited it offline.",
            server: toTxnDTO(existing, await lookupsFor()),
          };
        } else {
          await updateTransaction(userId, op.txnId, op.payload, { opId: op.opId });
          result = { opId: op.opId, status: "applied", txnId: op.txnId, updatedAt: await stampOf(op.txnId) };
        }
      } else {
        if (!existing) {
          result = { opId: op.opId, status: "applied", txnId: null, updatedAt: null };
        } else if (!op.force && existing.updatedAt.toISOString() !== op.baseUpdatedAt) {
          return {
            opId: op.opId,
            status: "conflict",
            message: "This record was changed on another device before your offline delete.",
            server: toTxnDTO(existing, await lookupsFor()),
          };
        } else {
          await deleteTransaction(userId, op.txnId);
          result = { opId: op.opId, status: "applied", txnId: null, updatedAt: null };
        }
      }
    }
  } catch (err) {
    if (err instanceof AppError) return { opId: op.opId, status: "rejected", error: err.message };
    if (err && typeof err === "object" && "issues" in err) {
      const issue = (err as { issues: { message: string }[] }).issues[0];
      return { opId: op.opId, status: "rejected", error: issue?.message ?? "Invalid data" };
    }
    throw err; // infrastructure error → the device keeps the op and retries later
  }
  // Only successes are remembered: a rejected op can be fixed and retried with the same id.
  await SyncOp.updateOne({ userId: uid, opId: op.opId }, { $setOnInsert: { result, createdAt: new Date() } }, { upsert: true });
  return result;
}
