import { connectDB } from "../db/connect";
import { FundingAllocation, Transaction, oid, type IncomeKind, type TxnType } from "../db/models";
import { addDays, todayISO } from "../dates";
import { compareLedgerOrder } from "../ledger/fifo";
import { SOURCE_TYPES, CONSUMER_TYPES } from "../ledger/engine";
import { categoryMap, getLookups } from "./lookups";

export type SourceStatus = "active" | "partial" | "exhausted";

export interface FundingSourceRecord {
  id: string;
  type: TxnType;
  kind: IncomeKind | "withdrawal";
  label: string;
  date: string;
  amount: number;
  used: number;
  remaining: number;
  status: SourceStatus;
  /** Date the last taka was spent, when exhausted. */
  exhaustedOn: string | null;
  /** Remaining balance when the next salary arrived (null for the latest salary). */
  carriedForward: number | null;
  nextSalaryDate: string | null;
}

interface LoadedLedger {
  sources: { id: string; type: TxnType; kind: IncomeKind | "withdrawal"; label: string; date: string; seq: number; amount: number }[];
  allocations: { consumerId: string; sourceId: string; amount: number; consumerDate: string }[];
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
  const bySource = new Map<string, { amount: number; consumerDate: string }[]>();
  for (const a of ledger.allocations) {
    if (!bySource.has(a.sourceId)) bySource.set(a.sourceId, []);
    bySource.get(a.sourceId)!.push(a);
  }
  const salaries = ledger.sources.filter((s) => s.kind === "salary");

  return ledger.sources.map((s) => {
    const allocs = bySource.get(s.id) ?? [];
    const used = allocs.reduce((acc, a) => acc + a.amount, 0);
    const remaining = s.amount - used;
    const next = salaries.find((x) => compareLedgerOrder(x, s) > 0 && x.date > s.date);
    const carriedForward = next
      ? s.amount - allocs.filter((a) => a.consumerDate < next.date).reduce((acc, a) => acc + a.amount, 0)
      : null;
    return {
      id: s.id,
      type: s.type,
      kind: s.kind,
      label: s.label,
      date: s.date,
      amount: s.amount,
      used,
      remaining,
      status: remaining === 0 ? "exhausted" : used === 0 ? "active" : "partial",
      exhaustedOn: remaining === 0 && allocs.length ? allocs.reduce((m, a) => (a.consumerDate > m ? a.consumerDate : m), "") : null,
      carriedForward,
      nextSalaryDate: next?.date ?? null,
    };
  });
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

export interface SalaryCycle {
  salaryId: string;
  label: string;
  start: string;
  /** Day before the next salary, or null while this is the current cycle. */
  end: string | null;
  nextSalaryDate: string | null;
  startingAmount: number;
  /** Unspent money from earlier sources at the moment this salary arrived. */
  carriedIn: number;
  /** Which earlier salaries (or other income) the carried-in money is left over from. */
  carriedFrom: { sourceId: string; label: string; date: string; amount: number }[];
  otherIncome: number;
  totalAvailable: number;
  totalSpent: number;
  fundedByThisSalary: number;
  fundedByPrevious: number;
  fundedByOther: number;
  thisSalaryRemaining: number;
  previousRemaining: number;
  /** Paid outflows dated in the cycle that are not yet funded (should always be 0). */
  unfunded: number;
  expenseCount: number;
  /** Money left when the period ended (= carried into the next salary); for the current period, left now. */
  remainingAtEnd: number;
}

/**
 * Salary cycles run from one salary's received date up to the day before the next.
 * Figures come from the FIFO funding ledger, so they line up exactly with
 * per-salary balances and never double-count carried-forward money.
 */
export async function getSalaryCycles(userId: string): Promise<SalaryCycle[]> {
  await connectDB();
  const ledger = await loadLedger(userId);
  const consumers = await Transaction.find(
    { userId: oid(userId), status: "paid", type: { $in: CONSUMER_TYPES } },
    { date: 1, amount: 1 },
  ).lean();

  const salaries = ledger.sources.filter((s) => s.kind === "salary");
  const order = new Map(ledger.sources.map((s, i) => [s.id, i]));

  return salaries.map((sal, i) => {
    const next = salaries.slice(i + 1).find((x) => x.date > sal.date) ?? null;
    const start = sal.date;
    const end = next ? addDays(next.date, -1) : null;
    const inCycle = (d: string) => d >= start && (end === null || d <= end);
    const myIdx = order.get(sal.id)!;

    const earlier = ledger.sources.filter((s) => order.get(s.id)! < myIdx);
    const earlierIds = new Set(earlier.map((s) => s.id));
    const usedBeforeStart = ledger.allocations
      .filter((a) => earlierIds.has(a.sourceId) && a.consumerDate < start)
      .reduce((acc, a) => acc + a.amount, 0);
    const carriedIn = earlier.reduce((acc, s) => acc + s.amount, 0) - usedBeforeStart;
    const carriedFrom = earlier
      .map((src) => ({
        sourceId: src.id,
        label: src.label,
        date: src.date,
        amount:
          src.amount -
          ledger.allocations.filter((a) => a.sourceId === src.id && a.consumerDate < start).reduce((acc, a) => acc + a.amount, 0),
      }))
      .filter((x) => x.amount > 0);

    const otherInCycle = ledger.sources.filter((s) => s.id !== sal.id && !earlierIds.has(s.id) && inCycle(s.date));
    const otherIncome = otherInCycle.reduce((acc, s) => acc + s.amount, 0);

    let fundedByThisSalary = 0, fundedByPrevious = 0, fundedByOther = 0, thisUsedThroughEnd = 0;
    const cycleConsumers = new Set<string>();
    for (const a of ledger.allocations) {
      if (a.sourceId === sal.id && (end === null || a.consumerDate <= end)) thisUsedThroughEnd += a.amount;
      if (!inCycle(a.consumerDate)) continue;
      cycleConsumers.add(a.consumerId);
      if (a.sourceId === sal.id) fundedByThisSalary += a.amount;
      else if (earlierIds.has(a.sourceId)) fundedByPrevious += a.amount;
      else fundedByOther += a.amount;
    }
    const spent = consumers.filter((c) => inCycle(c.date));
    const totalSpent = spent.reduce((acc, c) => acc + c.amount, 0);

    return {
      salaryId: sal.id,
      label: sal.label,
      start,
      end,
      nextSalaryDate: next?.date ?? null,
      startingAmount: sal.amount,
      carriedIn,
      carriedFrom,
      otherIncome,
      totalAvailable: carriedIn + sal.amount + otherIncome,
      totalSpent,
      fundedByThisSalary,
      fundedByPrevious,
      fundedByOther,
      thisSalaryRemaining: sal.amount - thisUsedThroughEnd,
      previousRemaining: carriedIn - fundedByPrevious,
      unfunded: totalSpent - (fundedByThisSalary + fundedByPrevious + fundedByOther),
      expenseCount: spent.length,
      remainingAtEnd: carriedIn + sal.amount + otherIncome - totalSpent,
    };
  });
}

/** The cycle containing `date` (defaults to today). */
export function currentCycle(cycles: SalaryCycle[], date: string = todayISO()): SalaryCycle | null {
  return [...cycles].reverse().find((c) => c.start <= date && (c.end === null || c.end >= date)) ?? null;
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
