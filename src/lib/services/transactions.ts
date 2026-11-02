import type { ClientSession, PipelineStage, Types } from "mongoose";
import { connectDB } from "../db/connect";
import {
  Account,
  Category,
  FundingAllocation,
  Person,
  SavingsGoal,
  Transaction,
  User,
  oid,
  type BillType,
  type IncomeKind,
  type PaymentMethod,
  type TransactionDoc,
  type TxnStatus,
  type TxnType,
} from "../db/models";
import { AppError, NotFoundError } from "../errors";
import { formatDate } from "../dates";
import { txnInputSchema, type TxnInput, type TxnInputRaw } from "../validation";
import { deriveTxn } from "../ledger/derive";
import { affectsFunding, recomputeFunding, withLedger } from "../ledger/engine";
import { categoryMap, categoryWithChildren, getLookups, type Lookups } from "./lookups";

/* ---------------------------------------------------------------- DTOs */

export interface TxnDTO {
  id: string;
  type: TxnType;
  status: TxnStatus;
  title: string;
  amount: number;
  date: string;
  attributionMonth: string;
  categoryId: string | null;
  categoryLabel: string | null;
  paymentMethod: PaymentMethod;
  accountId: string | null;
  accountName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  personId: string | null;
  personName: string | null;
  goalId: string | null;
  goalName: string | null;
  notes: string | null;
  incomeKind: IncomeKind | null;
  incomeLabel: string | null;
  items: { id: string; name: string; amount: number; categoryId: string | null; categoryLabel: string | null; notes: string | null }[];
  bill: {
    billType: BillType;
    rechargeDate: string | null;
    coverageFrom: string | null;
    coverageTo: string | null;
    recurringBillId: string | null;
  } | null;
  fundingSourceId: string | null;
  createdAt: string;
  /** Server version stamp — offline edits send it back so changes made elsewhere are never overwritten. */
  updatedAt: string;
  runningBalance?: number;
}

type LeanTxn = Omit<TransactionDoc, never> & { runningBalance?: number };

export function toTxnDTO(t: LeanTxn, lookups: Lookups): TxnDTO {
  const cats = categoryMap(lookups);
  const account = (id?: Types.ObjectId | null) => (id ? lookups.accounts.find((a) => a.id === id.toString()) : undefined);
  return {
    id: t._id.toString(),
    type: t.type,
    status: t.status,
    title: t.title,
    amount: t.amount,
    date: t.date,
    attributionMonth: t.attributionMonth,
    categoryId: t.categoryId?.toString() ?? null,
    categoryLabel: t.categoryId ? (cats.get(t.categoryId.toString())?.label ?? "Deleted category") : null,
    paymentMethod: t.paymentMethod,
    accountId: t.accountId?.toString() ?? null,
    accountName: account(t.accountId)?.name ?? null,
    toAccountId: t.toAccountId?.toString() ?? null,
    toAccountName: account(t.toAccountId)?.name ?? null,
    personId: t.personId?.toString() ?? null,
    personName: t.personId ? (lookups.persons.find((p) => p.id === t.personId!.toString())?.name ?? null) : null,
    goalId: t.goalId?.toString() ?? null,
    goalName: t.goalId ? (lookups.goals.find((g) => g.id === t.goalId!.toString())?.name ?? null) : null,
    notes: t.notes ?? null,
    incomeKind: t.income?.kind ?? null,
    incomeLabel: t.income?.label ?? null,
    items: (t.items ?? []).map((i) => ({
      id: i._id.toString(),
      name: i.name,
      amount: i.amount,
      categoryId: i.categoryId?.toString() ?? null,
      categoryLabel: i.categoryId ? (cats.get(i.categoryId.toString())?.label ?? null) : null,
      notes: i.notes ?? null,
    })),
    bill: t.bill
      ? {
          billType: t.bill.billType,
          rechargeDate: t.bill.rechargeDate ?? null,
          coverageFrom: t.bill.coverageFrom ?? null,
          coverageTo: t.bill.coverageTo ?? null,
          recurringBillId: t.bill.recurringBillId?.toString() ?? null,
        }
      : null,
    fundingSourceId: t.fundingSourceId?.toString() ?? null,
    createdAt: new Date(t.createdAt).toISOString(),
    updatedAt: new Date(t.updatedAt ?? t.createdAt).toISOString(),
    runningBalance: t.runningBalance,
  };
}

/* ---------------------------------------------------------------- Normalization */

async function assertOwned(
  userId: Types.ObjectId,
  model: { countDocuments: (q: object) => { exec: () => Promise<number> } },
  ids: (string | undefined)[],
  label: string,
) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return;
  const found = await model.countDocuments({ userId, _id: { $in: unique.map((i) => oid(i)) } }).exec();
  if (found !== unique.length) throw new AppError(`Selected ${label} does not exist`);
}

/**
 * Turn validated input into the stored document shape, enforcing the ledger rules:
 * breakdown totals are derived from items, only expenses can be pending, references
 * must belong to the user.
 */
async function normalize(userId: string, input: TxnInput): Promise<Omit<TransactionDoc, "_id" | "createdAt" | "updatedAt">> {
  const uid = oid(userId);
  const isExpense = input.type === "expense";

  let categoryId = isExpense ? input.categoryId : undefined;
  if (isExpense && !categoryId) {
    const others = await Category.findOne({ userId: uid, systemKey: "others" }, { _id: 1 }).lean();
    categoryId = others?._id.toString();
  }

  let accountId = input.accountId;
  if (!accountId) {
    const def = await Account.findOne({ userId: uid, isDefault: true }, { _id: 1 }).lean();
    accountId = def?._id.toString();
  }

  await Promise.all([
    assertOwned(uid, Category, [categoryId, ...input.items.map((i) => i.categoryId)], "category"),
    assertOwned(uid, Account, [accountId, input.type === "transfer" ? input.toAccountId : undefined], "account"),
    assertOwned(uid, Person, [input.personId], "person"),
    assertOwned(uid, SavingsGoal, [input.type.startsWith("savings_") ? input.goalId : undefined], "savings goal"),
  ]);

  if (input.fundingSourceId) {
    const src = await Transaction.findOne({ _id: oid(input.fundingSourceId), userId: uid, type: "income" }, { _id: 1 }).lean();
    if (!src) throw new AppError("Selected funding salary does not exist");
  }

  // Same derivation the offline app uses to preview queued changes (lib/ledger/derive.ts).
  const d = deriveTxn(input, { othersCategoryId: categoryId ?? null, defaultAccountId: accountId ?? null });
  const toId = (v: string | null) => (v ? oid(v) : null);
  return {
    ...d,
    userId: uid,
    categoryId: toId(d.categoryId),
    accountId: toId(d.accountId),
    toAccountId: toId(d.toAccountId),
    personId: toId(d.personId),
    goalId: toId(d.goalId),
    income: d.income as TransactionDoc["income"],
    items: d.items.map((i) => ({ ...i, categoryId: toId(i.categoryId) })) as TransactionDoc["items"],
    bill: d.bill ? { ...d.bill, recurringBillId: toId(d.bill.recurringBillId) } : null,
    fundingSourceId: toId(d.fundingSourceId),
    importBatch: null,
  };
}

/** A savings fund's balance must never dip below zero at any point in time. */
export async function assertGoalNeverNegative(userId: string, goalId: Types.ObjectId, session: ClientSession) {
  const moves = await Transaction.find(
    { userId: oid(userId), goalId, type: { $in: ["savings_deposit", "savings_withdrawal"] } },
    { type: 1, amount: 1, date: 1 },
  )
    .sort({ date: 1, createdAt: 1 })
    .session(session)
    .lean();
  let balance = 0;
  for (const m of moves) {
    balance += m.type === "savings_deposit" ? m.amount : -m.amount;
    if (balance < 0) {
      throw new AppError(`Withdrawal on ${formatDate(m.date)} exceeds the fund balance available at that time`);
    }
  }
}

/* ---------------------------------------------------------------- Mutations */

export async function createTransaction(
  userId: string,
  raw: TxnInputRaw,
  opts: { session?: ClientSession; importBatch?: string; clientRef?: string } = {},
): Promise<string> {
  const input = txnInputSchema.parse(raw);
  await connectDB();
  const doc = await normalize(userId, input);
  if (opts.importBatch) doc.importBatch = opts.importBatch;
  if (opts.clientRef) doc.clientRef = opts.clientRef;

  const run = async (session: ClientSession) => {
    const [created] = await Transaction.create([doc], { session });
    const id = created._id.toString();
    if (affectsFunding(doc)) {
      await recomputeFunding(userId, doc.date, session, { reason: `Added “${doc.title}”`, triggerId: id });
    }
    if (doc.goalId) await assertGoalNeverNegative(userId, doc.goalId, session);
    return id;
  };

  const id = opts.session ? await run(opts.session) : await withLedger(userId, run);

  if (doc.type === "expense" && !opts.importBatch) {
    await User.updateOne(
      { _id: oid(userId) },
      { $set: { "prefs.lastCategoryId": doc.categoryId, "prefs.lastPaymentMethod": doc.paymentMethod, "prefs.lastAccountId": doc.accountId } },
    );
  }
  return id;
}

/**
 * Create, unless this device's id (clientRef) was already saved — a retried or late-arriving
 * save then returns the existing record instead of adding a duplicate.
 */
export async function createTransactionOnce(userId: string, raw: TxnInputRaw, clientRef: string): Promise<string> {
  await connectDB();
  const existing = await Transaction.findOne({ userId: oid(userId), clientRef }, { _id: 1 }).lean();
  return existing ? existing._id.toString() : createTransaction(userId, raw, { clientRef });
}

export async function updateTransaction(userId: string, id: string, raw: TxnInputRaw, opts: { opId?: string } = {}): Promise<void> {
  const input = txnInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  const existing = await Transaction.findOne({ _id: oid(id), userId: uid }).lean();
  if (!existing) throw new NotFoundError("Transaction");
  if (existing.type !== input.type) throw new AppError("The transaction type cannot be changed. Delete it and add a new one.");

  const next = await normalize(userId, input);
  next.importBatch = existing.importBatch ?? null;
  if (opts.opId) next.lastOpId = opts.opId;

  await withLedger(userId, async (session) => {
    // $set (not replace) so createdAt — the same-day ordering key — is preserved.
    await Transaction.updateOne({ _id: existing._id, userId: uid }, { $set: next }, { session });
    if (affectsFunding(existing) || affectsFunding(next)) {
      const fromDate = existing.date < next.date ? existing.date : next.date;
      await recomputeFunding(userId, fromDate, session, { reason: `Edited “${next.title}”`, triggerId: id });
    }
    for (const goalId of new Set([existing.goalId?.toString(), next.goalId?.toString()])) {
      if (goalId) await assertGoalNeverNegative(userId, oid(goalId), session);
    }
  });
}

export async function deleteTransaction(userId: string, id: string): Promise<void> {
  await connectDB();
  const uid = oid(userId);
  const existing = await Transaction.findOne({ _id: oid(id), userId: uid }).lean();
  if (!existing) throw new NotFoundError("Transaction");

  await withLedger(userId, async (session) => {
    await Transaction.deleteOne({ _id: existing._id, userId: uid }, { session });
    // Expenses that asked to be funded by this income fall back to plain FIFO.
    await Transaction.updateMany({ userId: uid, fundingSourceId: existing._id }, { $set: { fundingSourceId: null } }, { session });
    if (affectsFunding(existing)) {
      await recomputeFunding(userId, existing.date, session, { reason: `Deleted “${existing.title}”` });
    }
    if (existing.goalId) await assertGoalNeverNegative(userId, existing.goalId, session);
  });
}

/** Pending → paid. The payment date defaults to the original (due) date. */
export async function markTransactionPaid(userId: string, id: string, paidDate?: string): Promise<void> {
  await connectDB();
  const uid = oid(userId);
  const existing = await Transaction.findOne({ _id: oid(id), userId: uid }).lean();
  if (!existing) throw new NotFoundError("Transaction");
  if (existing.status === "paid") return;
  const date = paidDate ?? existing.date;

  await withLedger(userId, async (session) => {
    await Transaction.updateOne({ _id: existing._id }, { $set: { status: "paid", date } }, { session });
    const fromDate = existing.date < date ? existing.date : date;
    await recomputeFunding(userId, fromDate, session, { reason: `Marked “${existing.title}” paid`, triggerId: id });
  });
}

/* ---------------------------------------------------------------- Queries */

export interface FundingLine {
  transactionId: string;
  title: string;
  date: string;
  amount: number;
}

export interface TxnDetail {
  txn: TxnDTO;
  /** For expenses / deposits: which incomes funded it. */
  fundedBy: FundingLine[];
  /** For incomes: which expenses it funded. */
  funds: FundingLine[];
}

export async function getTransactionDetail(userId: string, id: string): Promise<TxnDetail | null> {
  await connectDB();
  const uid = oid(userId);
  const txn = await Transaction.findOne({ _id: oid(id), userId: uid }).lean();
  if (!txn) return null;
  const [lookups, asConsumer, asSource] = await Promise.all([
    getLookups(userId),
    FundingAllocation.find({ userId: uid, consumerId: txn._id }).lean(),
    FundingAllocation.find({ userId: uid, sourceId: txn._id }).sort({ consumerDate: 1, createdAt: 1 }).lean(),
  ]);
  const relatedIds = [...asConsumer.map((a) => a.sourceId), ...asSource.map((a) => a.consumerId)];
  const related = await Transaction.find({ _id: { $in: relatedIds } }, { title: 1, date: 1, income: 1 }).lean();
  const relatedMap = new Map(related.map((r) => [r._id.toString(), r]));
  const line = (txId: Types.ObjectId, amount: number): FundingLine => {
    const r = relatedMap.get(txId.toString());
    return {
      transactionId: txId.toString(),
      title: r?.income?.label || r?.title || "Deleted",
      date: r?.date ?? "",
      amount,
    };
  };
  return {
    txn: toTxnDTO(txn, lookups),
    fundedBy: asConsumer.map((a) => line(a.sourceId, a.amount)).sort((a, b) => a.date.localeCompare(b.date)),
    funds: asSource.map((a) => line(a.consumerId, a.amount)),
  };
}

export interface TxnFilters {
  q?: string;
  from?: string;
  to?: string;
  type?: TxnType;
  status?: TxnStatus;
  categoryId?: string;
  personId?: string;
  /** "out" = expenses + savings deposits, "in" = income + savings withdrawals. */
  flow?: "in" | "out";
  billOnly?: boolean;
  goalId?: string;
  page?: number;
  pageSize?: number;
}

/** Signed effect of a transaction on the spendable balance (MongoDB expression). */
export const SPENDABLE_DELTA_EXPR = {
  $cond: [
    { $eq: ["$status", "paid"] },
    {
      $switch: {
        branches: [
          { case: { $in: ["$type", ["income", "savings_withdrawal"]] }, then: "$amount" },
          { case: { $in: ["$type", ["expense", "savings_deposit"]] }, then: { $multiply: ["$amount", -1] } },
        ],
        default: 0,
      },
    },
    0,
  ],
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Transaction history, newest first, with the spendable running balance after each row.
 * The running balance is computed over the full ledger (in ledger order) before filters
 * apply, so a filtered view still shows true balances.
 */
export async function listTransactions(userId: string, filters: TxnFilters, lookups?: Lookups) {
  await connectDB();
  const uid = oid(userId);
  const lk = lookups ?? (await getLookups(userId));
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 50));

  const match: Record<string, unknown> = {};
  if (filters.from || filters.to) {
    match.date = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) };
  }
  if (filters.type) match.type = filters.type;
  else if (filters.flow === "out") match.type = { $in: ["expense", "savings_deposit"] };
  else if (filters.flow === "in") match.type = { $in: ["income", "savings_withdrawal"] };
  if (filters.status) match.status = filters.status;
  if (filters.personId) match.personId = oid(filters.personId);
  if (filters.billOnly) match.bill = { $ne: null };
  if (filters.goalId) match.goalId = oid(filters.goalId);
  if (filters.categoryId) {
    const ids = categoryWithChildren(lk, filters.categoryId).map((c) => oid(c));
    match.$or = [{ categoryId: { $in: ids } }, { "items.categoryId": { $in: ids } }];
  }
  if (filters.q?.trim()) {
    const rx = { $regex: escapeRegex(filters.q.trim()), $options: "i" };
    const textOr = [{ title: rx }, { notes: rx }, { "items.name": rx }, { "income.label": rx }];
    if (match.$or) {
      match.$and = [{ $or: match.$or }, { $or: textOr }];
      delete match.$or;
    } else {
      match.$or = textOr;
    }
  }

  const pipeline: PipelineStage[] = [
    { $match: { userId: uid } },
    { $addFields: { _delta: SPENDABLE_DELTA_EXPR } },
    {
      $setWindowFields: {
        sortBy: { date: 1, createdAt: 1, _id: 1 },
        output: { runningBalance: { $sum: "$_delta", window: { documents: ["unbounded", "current"] } } },
      },
    },
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    { $sort: { date: -1, createdAt: -1, _id: -1 } },
    {
      $facet: {
        rows: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $project: { _delta: 0 } }],
        total: [{ $count: "n" }],
        // Totals for the whole filtered list (not just this page), so a filtered view always
        // explains its own numbers.
        sums: [
          {
            $group: {
              _id: null,
              moneyIn: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "paid"] }, { $in: ["$type", ["income", "savings_withdrawal"]] }] }, "$amount", 0] } },
              moneyOut: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "paid"] }, { $in: ["$type", ["expense", "savings_deposit"]] }] }, "$amount", 0] } },
              pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] } },
              pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
            },
          },
        ],
      },
    },
  ];

  const [res] = await Transaction.aggregate<{
    rows: LeanTxn[];
    total: { n: number }[];
    sums: { moneyIn: number; moneyOut: number; pending: number; pendingCount: number }[];
  }>(pipeline);
  const total = res?.total[0]?.n ?? 0;
  const sums = res?.sums[0];
  return {
    rows: (res?.rows ?? []).map((r) => toTxnDTO(r, lk)),
    total,
    totals: { moneyIn: sums?.moneyIn ?? 0, moneyOut: sums?.moneyOut ?? 0, pending: sums?.pending ?? 0, pendingCount: sums?.pendingCount ?? 0 },
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Incomes available as manual funding overrides (most recent first). */
export async function listIncomeOptions(userId: string) {
  await connectDB();
  const rows = await Transaction.find({ userId: oid(userId), type: "income" }, { title: 1, date: 1, amount: 1, income: 1 })
    .sort({ date: -1, createdAt: -1 })
    .limit(36)
    .lean();
  return rows.map((r) => ({ id: r._id.toString(), label: r.income?.label || r.title, date: r.date, amount: r.amount }));
}
