import { connectDB } from "../db/connect";
import { FundingAllocation, Transaction, oid, type IncomeKind, type TxnType } from "../db/models";
import { todayISO } from "../dates";
import { compareLedgerOrder } from "../ledger/fifo";
import {
  buildFundingRecords,
  buildSalaryCycles,
  currentCycle as modelCurrentCycle,
  type AllocItem,
  type FundingSourceRecord,
  type SalaryCycle,
  type SourceItem,
} from "../ledger/model";
import { SOURCE_TYPES, CONSUMER_TYPES } from "../ledger/engine";
import { categoryMap, getLookups } from "./lookups";

export type { FundingSourceRecord, SalaryCycle, SourceStatus } from "../ledger/model";

interface LoadedLedger {
  sources: SourceItem[];
  /** The stored FIFO funding ledger. */
  allocations: AllocItem[];
}

async function loadLedger(userId: string): Promise<LoadedLedger> {
  await connectDB();
  const uid = oid(userId);
  const [srcDocs, allocDocs] = await Promise.all([
    Transaction.find(
      { userId: uid, status: "paid", type: { $in: SOURCE_TYPES } },
      { type: 1, title: 1, date: 1, amount: 1, income: 1, createdAt: 1 },
    ).lean(),
    FundingAllocation.find({ userId: uid }, { consumerId: 1, sourceId: 1, amount: 1, consumerDate: 1 }).lean(),
  ]);
  const sources = srcDocs
    .map((s) => ({
      id: s._id.toString(),
      type: s.type,
      kind: (s.type === "income" ? (s.income?.kind ?? "other") : "withdrawal") as IncomeKind | "withdrawal",
      label: s.income?.label || s.title,
      date: s.date,
      seq: s.createdAt.getTime(),
      amount: s.amount,
    }))
    .sort(compareLedgerOrder);
  const allocations = allocDocs.map((a) => ({
    consumerId: a.consumerId.toString(),
    sourceId: a.sourceId.toString(),
    amount: a.amount,
    consumerDate: a.consumerDate,
  }));
  return { sources, allocations };
}

function buildRecords(ledger: LoadedLedger): FundingSourceRecord[] {
  return buildFundingRecords(ledger.sources, ledger.allocations);
}

/** Every funding source (salaries, other income, savings withdrawals) with derived balances. */
export async function getFundingSources(userId: string): Promise<FundingSourceRecord[]> {
  return buildRecords(await loadLedger(userId));
}

export interface FundedExpense {
  transactionId: string;
  type: TxnType;
  title: string;
  date: string;
  categoryLabel: string | null;
  totalAmount: number;
  fundedAmount: number;
  /** This source's remaining balance after funding this expense. */
  remainingAfter: number;
  /** True when other sources also funded part of this expense. */
  split: boolean;
}

export async function getSalaryFundingHistory(userId: string, sourceId: string) {
  const [ledger, lookups] = await Promise.all([loadLedger(userId), getLookups(userId)]);
  const record = buildRecords(ledger).find((r) => r.id === sourceId);
  if (!record) return null;

  const mine = ledger.allocations.filter((a) => a.sourceId === sourceId);
  const consumerIds = [...new Set(mine.map((a) => a.consumerId))];
  const consumers = await Transaction.find(
    { _id: { $in: consumerIds.map((id) => oid(id)) } },
    { type: 1, title: 1, date: 1, amount: 1, categoryId: 1, createdAt: 1 },
  ).lean();
  const cmap = new Map(consumers.map((c) => [c._id.toString(), c]));
  const cats = categoryMap(lookups);
  const otherFunders = new Set(ledger.allocations.filter((a) => a.sourceId !== sourceId).map((a) => a.consumerId));

  const rows = mine
    .map((a) => ({ a, c: cmap.get(a.consumerId)! }))
    .filter((x) => x.c)
    .sort((x, y) => x.c.date.localeCompare(y.c.date) || x.c.createdAt.getTime() - y.c.createdAt.getTime());

  let left = record.amount;
  const expenses: FundedExpense[] = rows.map(({ a, c }) => {
    left -= a.amount;
    return {
      transactionId: a.consumerId,
      type: c.type,
      title: c.title,
      date: c.date,
      categoryLabel: c.categoryId ? (cats.get(c.categoryId.toString())?.label ?? null) : c.type === "savings_deposit" ? "Savings deposit" : null,
      totalAmount: c.amount,
      fundedAmount: a.amount,
      remainingAfter: left,
      split: otherFunders.has(a.consumerId),
    };
  });
  return { record, expenses };
}

/* ------------------------------------------------------------------ Salary cycles */

/**
 * Salary cycles run from one salary's received date up to the day before the next
 * (computed by the shared model from the stored FIFO funding ledger).
 */
export async function getSalaryCycles(userId: string): Promise<SalaryCycle[]> {
  await connectDB();
  const ledger = await loadLedger(userId);
  const consumers = await Transaction.find(
    { userId: oid(userId), status: "paid", type: { $in: CONSUMER_TYPES } },
    { date: 1, amount: 1 },
  ).lean();
  return buildSalaryCycles(
    ledger.sources,
    ledger.allocations,
    consumers.map((c) => ({ id: c._id.toString(), date: c.date, amount: c.amount })),
  );
}

/** The cycle containing `date` (defaults to today). */
export function currentCycle(cycles: SalaryCycle[], date: string = todayISO()): SalaryCycle | null {
  return modelCurrentCycle(cycles, date);
}

export interface SalaryPeriodPayment {
  id: string;
  date: string;
  title: string;
  type: TxnType;
  amount: number;
  categoryLabel: string | null;
}

/**
 * Month-by-month salary history: each salary period (received date → day before the next
 * salary) with what was carried in, received, spent, and carried on — plus every payment
 * made in that period. Newest first.
 */
export async function getSalaryHistory(userId: string) {
  const [cycles, lookups] = await Promise.all([getSalaryCycles(userId), getLookups(userId)]);
  const cats = categoryMap(lookups);
  const docs = await Transaction.find(
    { userId: oid(userId), status: "paid", type: { $in: CONSUMER_TYPES } },
    { date: 1, title: 1, type: 1, amount: 1, categoryId: 1, createdAt: 1 },
  )
    .sort({ date: 1, createdAt: 1 })
    .lean();
  return [...cycles].reverse().map((c) => ({
    ...c,
    payments: docs
      .filter((d) => d.date >= c.start && (c.end === null || d.date <= c.end))
      .map<SalaryPeriodPayment>((d) => ({
        id: d._id.toString(),
        date: d.date,
        title: d.title,
        type: d.type,
        amount: d.amount,
        categoryLabel: d.categoryId ? (cats.get(d.categoryId.toString())?.label ?? null) : d.type === "savings_deposit" ? "Moved to savings" : null,
      })),
  }));
}
