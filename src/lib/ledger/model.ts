/**
 * The financial model, as pure functions over plain records.
 *
 * Used by BOTH the server (data loaded from MongoDB) and the offline app (data from
 * IndexedDB), so every figure — FIFO salary funding, carryforward, salary periods, category
 * totals, balances, savings, borrowed money — is computed by exactly the same code in both
 * places. No database imports here: this module must stay safe to ship to the browser.
 */
import { SPENDABLE_IN_TYPES, SPENDABLE_OUT_TYPES, type CategoryNature, type IncomeKind, type TxnStatus, type TxnType } from "../constants";
import { addDays } from "../dates";
import { allocateFifo, compareLedgerOrder, type FundingConsumer, type FundingSource, type Shortfall } from "./fifo";

/* ------------------------------------------------------------------ Shapes */

/** The fields of a transaction the model needs. TxnDTO satisfies this. */
export interface LedgerTxn {
  id: string;
  type: TxnType;
  status: TxnStatus;
  title: string;
  amount: number;
  date: string;
  attributionMonth: string;
  categoryId: string | null;
  personId: string | null;
  goalId: string | null;
  incomeKind: IncomeKind | null;
  incomeLabel: string | null;
  items: { amount: number; categoryId: string | null }[];
  fundingSourceId: string | null;
  /** ISO timestamp — same-day ordering key. */
  createdAt: string;
}

export interface CategoryInfo {
  id: string;
  name: string;
  parentId: string | null;
  rootId: string;
  rootName: string;
  nature: CategoryNature;
}

export interface PersonAllocationInfo {
  personId: string;
  month: string;
  amount: number;
  note?: string | null;
}

/* ------------------------------------------------------------------ Ledger roles */

/**
 * Money arriving into the spendable pool. Besides income this includes money that is not
 * income (a savings withdrawal, investment capital returned), so it can pay for later
 * expenses (FIFO) without ever being counted as income. Lending & Borrowing is never part of
 * the pool: borrowed money and loan repayments are not sources (see LOAN_TYPES).
 */
export const SOURCE_TYPES: TxnType[] = SPENDABLE_IN_TYPES;
/** Money leaving the spendable pool: expenses, and moves that are not expenses (saving, investing). Lending and repaying a lender are not. */
export const CONSUMER_TYPES: TxnType[] = SPENDABLE_OUT_TYPES;

/** What a funding source is, for labels: an income kind, or a non-income inflow. */
export type SourceKind = IncomeKind | "withdrawal" | "loan" | "capital";
export function sourceKindOf(type: TxnType, incomeKind: IncomeKind | null | undefined): SourceKind {
  if (type === "income") return incomeKind ?? "other";
  if (type === "loan_in") return "loan";
  if (type === "invest_in") return "capital";
  return "withdrawal";
}

export function isSource(t: { type: TxnType; status: TxnStatus }): boolean {
  return t.status === "paid" && SOURCE_TYPES.includes(t.type);
}
export function isConsumer(t: { type: TxnType; status: TxnStatus }): boolean {
  return t.status === "paid" && CONSUMER_TYPES.includes(t.type);
}
export function affectsFunding(t: { type: TxnType; status: TxnStatus }): boolean {
  return isSource(t) || isConsumer(t);
}

/** Signed effect on the spendable balance (mirrors SPENDABLE_DELTA_EXPR on the server). Loans: always 0. */
export function spendableDelta(t: { type: TxnType; status: TxnStatus; amount: number }): number {
  if (t.status !== "paid") return 0;
  if (SPENDABLE_IN_TYPES.includes(t.type)) return t.amount;
  if (SPENDABLE_OUT_TYPES.includes(t.type)) return -t.amount;
  return 0;
}

const seqOf = (t: { createdAt: string | Date }) => (typeof t.createdAt === "string" ? Date.parse(t.createdAt) : t.createdAt.getTime());

/** Ledger order: date, then creation time, then id. */
export function sortLedger<T extends { date: string; createdAt: string | Date; id: string }>(txns: T[]): T[] {
  return [...txns].sort((a, b) => compareLedgerOrder({ ...a, seq: seqOf(a), amount: 0 }, { ...b, seq: seqOf(b), amount: 0 }));
}

/* ------------------------------------------------------------------ Expense lines & categories */

export interface ExpenseLine {
  categoryId: string | null;
  amount: number;
}

type IdLike = string | { toString(): string } | null | undefined;
const idStr = (v: IdLike) => (v == null ? null : v.toString());

/** Split an expense into reporting lines. Breakdown items replace the parent — never both. */
export function expenseLines(t: { amount: number; categoryId?: IdLike; items?: { amount: number; categoryId?: IdLike }[] }): ExpenseLine[] {
  if (t.items && t.items.length > 0) {
    return t.items.map((i) => ({ categoryId: idStr(i.categoryId ?? t.categoryId), amount: i.amount }));
  }
  return [{ categoryId: idStr(t.categoryId), amount: t.amount }];
}

export interface CategoryTotal {
  id: string;
  name: string;
  total: number;
  children: { id: string; name: string; total: number }[];
}

export function groupByCategory(lines: ExpenseLine[], lookups: { categories: CategoryInfo[] }): CategoryTotal[] {
  const cats = new Map(lookups.categories.map((c) => [c.id, c]));
  const roots = new Map<string, CategoryTotal>();
  for (const line of lines) {
    const cat = line.categoryId ? cats.get(line.categoryId) : undefined;
    const rootId = cat?.rootId ?? "uncategorized";
    const rootName = cat?.rootName ?? "Uncategorized";
    let root = roots.get(rootId);
    if (!root) {
      root = { id: rootId, name: rootName, total: 0, children: [] };
      roots.set(rootId, root);
    }
    root.total += line.amount;
    if (cat && cat.parentId) {
      let child = root.children.find((c) => c.id === cat.id);
      if (!child) {
        child = { id: cat.id, name: cat.name, total: 0 };
        root.children.push(child);
      }
      child.total += line.amount;
    }
  }
  const list = [...roots.values()].sort((a, b) => b.total - a.total);
  for (const r of list) r.children.sort((a, b) => b.total - a.total);
  return list;
}

function natureOf(lookups: { categories: CategoryInfo[] }) {
  const map = new Map(lookups.categories.map((c) => [c.id, c.nature]));
  return (id: string | null) => (id ? map.get(id) : undefined);
}

/* ------------------------------------------------------------------ Period totals */

export interface PeriodTotals {
  openingBalance: number;
  salary: number;
  additionalIncome: number;
  /** Opening-balance entries (money that existed before tracking began). */
  broughtIn: number;
  totalIncome: number;
  totalAvailable: number;
  /** Consumption expenses (excludes investment-type categories). */
  expenses: number;
  investments: number;
  savingsDeposits: number;
  savingsWithdrawals: number;
  /** Investments + net savings moves. */
  savingsAndTransfers: number;
  /** Investment capital returned (not income). */
  otherInflows: number;
  /** Money borrowed, or repaid to you — shown for information, never added to the balance. */
  loansIn: number;
  /** Money lent, or repaid to a lender — shown for information, never deducted from the balance. */
  loansOut: number;
  totalOutflows: number;
  closingBalance: number;
  pendingTotal: number;
  daily: { date: string; total: number }[];
}

/** Totals for the transactions of one period, given the balance before it started. */
export function summarizePeriod(
  opening: number,
  txns: { type: TxnType; status: TxnStatus; amount: number; date: string; categoryId?: IdLike; incomeKind?: IncomeKind | null }[],
  lookups: { categories: CategoryInfo[] },
): PeriodTotals {
  const nature = natureOf(lookups);
  let salary = 0, additionalIncome = 0, broughtIn = 0, expenses = 0, investments = 0;
  let savingsDeposits = 0, savingsWithdrawals = 0, pendingTotal = 0, otherInflows = 0, loansIn = 0, loansOut = 0;
  const daily = new Map<string, number>();
  for (const t of txns) {
    if (t.status === "pending") {
      pendingTotal += t.amount;
      continue;
    }
    switch (t.type) {
      case "income":
        if (t.incomeKind === "salary") salary += t.amount;
        else if (t.incomeKind === "opening") broughtIn += t.amount;
        else additionalIncome += t.amount;
        break;
      case "expense":
        if (nature(idStr(t.categoryId)) === "saving") investments += t.amount;
        else expenses += t.amount;
        daily.set(t.date, (daily.get(t.date) ?? 0) + t.amount);
        break;
      case "savings_deposit":
        savingsDeposits += t.amount;
        break;
      case "savings_withdrawal":
        savingsWithdrawals += t.amount;
        break;
      case "invest_out":
        investments += t.amount;
        break;
      case "invest_in":
        otherInflows += t.amount;
        break;
      case "loan_in":
        loansIn += t.amount;
        break;
      case "loan_out":
        loansOut += t.amount;
        break;
    }
  }
  const totalIncome = salary + additionalIncome;
  const totalAvailable = opening + totalIncome + broughtIn + otherInflows;
  const savingsAndTransfers = investments + savingsDeposits - savingsWithdrawals;
  // Loans (loansIn / loansOut) are left out on purpose: they never change the remaining balance.
  const totalOutflows = expenses + savingsAndTransfers;
  return {
    openingBalance: opening,
    salary,
    additionalIncome,
    broughtIn,
    totalIncome,
    totalAvailable,
    expenses,
    investments,
    savingsDeposits,
    savingsWithdrawals,
    savingsAndTransfers,
    otherInflows,
    loansIn,
    loansOut,
    totalOutflows,
    closingBalance: totalAvailable - totalOutflows,
    pendingTotal,
    daily: [...daily.entries()].map(([date, total]) => ({ date, total })),
  };
}

/* ------------------------------------------------------------------ Balances */

export interface Balances {
  spendable: number;
  savings: number;
  pendingTotal: number;
  pendingCount: number;
}

export function balanceSummary(txns: LedgerTxn[], asOf: string): Balances {
  let spendable = 0, savings = 0, pendingTotal = 0, pendingCount = 0;
  for (const t of txns) {
    if (t.status === "pending") {
      pendingTotal += t.amount;
      pendingCount++;
    }
    if (t.date > asOf) continue;
    spendable += spendableDelta(t);
    if (t.type === "savings_deposit") savings += t.amount;
    if (t.type === "savings_withdrawal") savings -= t.amount;
  }
  return { spendable, savings, pendingTotal, pendingCount };
}

/** Spendable balance after each transaction, in ledger order. */
export function runningBalances(txns: LedgerTxn[]): Map<string, number> {
  const out = new Map<string, number>();
  let running = 0;
  for (const t of sortLedger(txns)) {
    running += spendableDelta(t);
    out.set(t.id, running);
  }
  return out;
}

/** Money invested and not yet returned: spending in "Investment / saving" categories + investments - capital returned. */
export function investedTotal(txns: LedgerTxn[], lookups: { categories: CategoryInfo[] }): number {
  const nature = natureOf(lookups);
  let total = 0;
  for (const t of txns) {
    if (t.status !== "paid") continue;
    if (t.type === "invest_out") total += t.amount;
    if (t.type === "invest_in") total -= t.amount;
    if (t.type !== "expense") continue;
    for (const line of expenseLines(t)) if (nature(line.categoryId) === "saving") total += line.amount;
  }
  return total;
}

/* ------------------------------------------------------------------ FIFO salary funding */

export interface SourceItem {
  id: string;
  type: TxnType;
  kind: SourceKind;
  label: string;
  date: string;
  seq: number;
  amount: number;
}
export interface AllocItem {
  consumerId: string;
  sourceId: string;
  amount: number;
  consumerDate: string;
}
export interface ConsumerItem {
  id: string;
  date: string;
  amount: number;
}

export function sourcesOf(txns: LedgerTxn[]): SourceItem[] {
  return txns
    .filter(isSource)
    .map((t) => ({
      id: t.id,
      type: t.type,
      kind: sourceKindOf(t.type, t.incomeKind),
      label: t.incomeLabel || t.title,
      date: t.date,
      seq: seqOf(t),
      amount: t.amount,
    }))
    .sort(compareLedgerOrder);
}

export function consumersOf(txns: LedgerTxn[]): ConsumerItem[] {
  return txns.filter(isConsumer).map((t) => ({ id: t.id, date: t.date, amount: t.amount }));
}

/** FIFO allocation from scratch (the server stores the same result; the offline app derives it). */
export function computeAllocations(txns: LedgerTxn[]): { allocations: AllocItem[]; shortfalls: Shortfall[] } {
  const sources: FundingSource[] = sourcesOf(txns);
  const consumers: FundingConsumer[] = txns
    .filter(isConsumer)
    .map((t) => ({ id: t.id, date: t.date, seq: seqOf(t), amount: t.amount, preferredSourceId: t.fundingSourceId }));
  const dateOf = new Map(consumers.map((c) => [c.id, c.date]));
  const r = allocateFifo(sources, consumers);
  return {
    allocations: r.allocations.map((a) => ({ ...a, consumerDate: dateOf.get(a.consumerId)! })),
    shortfalls: r.shortfalls,
  };
}

export type SourceStatus = "active" | "partial" | "exhausted";

export interface FundingSourceRecord {
  id: string;
  type: TxnType;
  kind: SourceKind;
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

export function buildFundingRecords(sources: SourceItem[], allocations: AllocItem[]): FundingSourceRecord[] {
  const bySource = new Map<string, AllocItem[]>();
  for (const a of allocations) {
    if (!bySource.has(a.sourceId)) bySource.set(a.sourceId, []);
    bySource.get(a.sourceId)!.push(a);
  }
  const salaries = sources.filter((s) => s.kind === "salary");
  return sources.map((s) => {
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
  /** Investment capital returned during the cycle (not income). Borrowed money is never counted. */
  otherInflows: number;
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
 * Salary periods run from one salary's received date up to the day before the next.
 * Figures come from the FIFO funding ledger, so they line up exactly with per-salary
 * balances and never double-count carried-forward money.
 */
export function buildSalaryCycles(sources: SourceItem[], allocations: AllocItem[], consumers: ConsumerItem[]): SalaryCycle[] {
  const salaries = sources.filter((s) => s.kind === "salary");
  const order = new Map(sources.map((s, i) => [s.id, i]));

  return salaries.map((sal, i) => {
    const next = salaries.slice(i + 1).find((x) => x.date > sal.date) ?? null;
    const start = sal.date;
    const end = next ? addDays(next.date, -1) : null;
    const inCycle = (d: string) => d >= start && (end === null || d <= end);
    const myIdx = order.get(sal.id)!;

    const earlier = sources.filter((s) => order.get(s.id)! < myIdx);
    const earlierIds = new Set(earlier.map((s) => s.id));
    const usedBeforeStart = allocations
      .filter((a) => earlierIds.has(a.sourceId) && a.consumerDate < start)
      .reduce((acc, a) => acc + a.amount, 0);
    const carriedIn = earlier.reduce((acc, s) => acc + s.amount, 0) - usedBeforeStart;
    const carriedFrom = earlier
      .map((src) => ({
        sourceId: src.id,
        label: src.label,
        date: src.date,
        amount: src.amount - allocations.filter((a) => a.sourceId === src.id && a.consumerDate < start).reduce((acc, a) => acc + a.amount, 0),
      }))
      .filter((x) => x.amount > 0);

    const laterInCycle = sources.filter((s) => s.id !== sal.id && !earlierIds.has(s.id) && inCycle(s.date));
    const notIncome = (s: SourceItem) => s.kind === "loan" || s.kind === "capital";
    const otherIncome = laterInCycle.filter((s) => !notIncome(s)).reduce((acc, s) => acc + s.amount, 0);
    const otherInflows = laterInCycle.filter(notIncome).reduce((acc, s) => acc + s.amount, 0);

    let fundedByThisSalary = 0, fundedByPrevious = 0, fundedByOther = 0, thisUsedThroughEnd = 0;
    for (const a of allocations) {
      if (a.sourceId === sal.id && (end === null || a.consumerDate <= end)) thisUsedThroughEnd += a.amount;
      if (!inCycle(a.consumerDate)) continue;
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
      otherInflows,
      totalAvailable: carriedIn + sal.amount + otherIncome + otherInflows,
      totalSpent,
      fundedByThisSalary,
      fundedByPrevious,
      fundedByOther,
      thisSalaryRemaining: sal.amount - thisUsedThroughEnd,
      previousRemaining: carriedIn - fundedByPrevious,
      unfunded: totalSpent - (fundedByThisSalary + fundedByPrevious + fundedByOther),
      expenseCount: spent.length,
      remainingAtEnd: carriedIn + sal.amount + otherIncome + otherInflows - totalSpent,
    };
  });
}

/** The cycle containing `date`. */
export function currentCycle(cycles: SalaryCycle[], date: string): SalaryCycle | null {
  return [...cycles].reverse().find((c) => c.start <= date && (c.end === null || c.end >= date)) ?? null;
}

/* ------------------------------------------------------------------ Borrowed money (Family & Allocations) */

export interface BorrowedOverview {
  total: number;
  repaid: number;
  remaining: number;
  byPerson: {
    id: string;
    name: string;
    borrowed: number;
    repaid: number;
    remaining: number;
    open: { month: string; remaining: number; note: string | null }[];
  }[];
}

export function borrowedOverview(
  persons: { id: string; name: string }[],
  allocations: PersonAllocationInfo[],
  txns: LedgerTxn[],
): BorrowedOverview {
  const byPerson = persons
    .map((p) => {
      const mine = allocations.filter((a) => a.personId === p.id);
      const payments = txns.filter((t) => t.type === "expense" && t.personId === p.id);
      const borrowed = mine.reduce((s, a) => s + a.amount, 0);
      const repaid = payments.filter((t) => t.status === "paid").reduce((s, t) => s + t.amount, 0);
      const open = mine
        .map((a) => {
          const paidForMonth = payments.filter((t) => t.status === "paid" && t.attributionMonth === a.month).reduce((s, t) => s + t.amount, 0);
          return { month: a.month, remaining: a.amount - paidForMonth, note: a.note ?? null };
        })
        .filter((a) => a.remaining > 0)
        .sort((a, b) => a.month.localeCompare(b.month));
      return { id: p.id, name: p.name, borrowed, repaid, remaining: Math.max(0, borrowed - repaid), open };
    })
    .filter((p) => p.borrowed > 0);
  const total = byPerson.reduce((s, p) => s + p.borrowed, 0);
  const repaid = byPerson.reduce((s, p) => s + Math.min(p.repaid, p.borrowed), 0);
  return { total, repaid, remaining: total - repaid, byPerson };
}

/* ------------------------------------------------------------------ Dashboard figures */

export interface DashboardInput {
  txns: LedgerTxn[];
  lookups: { categories: CategoryInfo[] };
  persons: { id: string; name: string }[];
  personAllocations: PersonAllocationInfo[];
  /** Stored FIFO allocations (server). When omitted they are derived from the transactions. */
  allocations?: AllocItem[];
  today: string;
}

/** The dashboard's salary-period figures and commitments — one implementation for server and device. */
export function computeDashboardFigures(input: DashboardInput) {
  const { txns, lookups, today } = input;
  const allocations = input.allocations ?? computeAllocations(txns).allocations;
  const sources = sourcesOf(txns);
  const records = buildFundingRecords(sources, allocations);
  const cycles = buildSalaryCycles(sources, allocations, consumersOf(txns));
  const cycle = currentCycle(cycles, today);
  const balance = balanceSummary(txns, today);
  const invested = investedTotal(txns, lookups);

  let period = null;
  if (cycle) {
    const opening = txns.filter((t) => t.date < cycle.start).reduce((s, t) => s + spendableDelta(t), 0);
    const inPeriod = sortLedger(txns.filter((t) => t.date >= cycle.start && t.date <= today));
    const pr = summarizePeriod(opening, inPeriod, lookups);
    period = {
      salaryId: cycle.salaryId,
      label: cycle.label,
      receivedOn: cycle.start,
      carriedIn: pr.openingBalance,
      carriedFrom: cycle.carriedFrom,
      salary: pr.salary,
      otherIncome: pr.additionalIncome + pr.broughtIn,
      /** Investment capital returned (not income). */
      otherInflows: pr.otherInflows,
      totalAvailable: pr.totalAvailable,
      spends: pr.totalOutflows,
      savedOrInvested: pr.savingsAndTransfers,
      paymentCount: inPeriod.filter((t) => t.status === "paid" && SPENDABLE_OUT_TYPES.includes(t.type)).length,
      remaining: pr.closingBalance,
    };
  }

  return {
    period,
    metrics: {
      /** Money you can spend right now. */
      availableNow: balance.spendable,
      /** Set aside outside spendable money: savings-goal funds + money invested (all time). */
      inSavings: balance.savings + invested,
      savingsGoals: balance.savings,
      invested,
      pendingTotal: balance.pendingTotal,
      pendingCount: balance.pendingCount,
    },
    borrowed: borrowedOverview(input.persons, input.personAllocations, txns),
    records,
    cycles,
    salaryBreakdown: records
      .filter((s) => s.kind === "salary" || s.remaining > 0)
      .slice(-6)
      .reverse(),
  };
}

export type DashboardFigures = ReturnType<typeof computeDashboardFigures>;
