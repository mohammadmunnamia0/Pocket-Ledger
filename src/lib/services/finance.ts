import type { Types } from "mongoose";
import { connectDB } from "../db/connect";
import { SavingsGoal, Transaction, oid, type TransactionDoc } from "../db/models";
import { addMonths, monthEnd, monthOf, monthStart, todayISO } from "../dates";
import { categoryMap, categoryWithChildren, getLookups, type Lookups } from "./lookups";
import { SPENDABLE_DELTA_EXPR, toTxnDTO, type TxnDTO } from "./transactions";

/**
 * Centralized financial calculations. Every figure here is derived from transaction
 * records at read time — nothing is stored as an editable total.
 *
 *   spendable  = Σ income + Σ savings withdrawals − Σ paid expenses − Σ savings deposits
 *   savings    = Σ savings deposits − Σ savings withdrawals
 *   transfers between own accounts change account balances only, never totals.
 *   pending expenses change nothing until they are marked paid.
 */

export interface BalanceSummary {
  /** Money freely available to spend (equals Σ remaining across all funding sources). */
  spendable: number;
  /** Money reserved in savings goals. */
  savings: number;
  pendingTotal: number;
  pendingCount: number;
}

export async function getBalanceSummary(userId: string, asOf: string = todayISO()): Promise<BalanceSummary> {
  await connectDB();
  const uid = oid(userId);
  const [res] = await Transaction.aggregate<{
    spendable: { v: number }[];
    savings: { v: number }[];
    pending: { v: number; n: number }[];
  }>([
    { $match: { userId: uid } },
    {
      $facet: {
        spendable: [
          { $match: { status: "paid", date: { $lte: asOf } } },
          { $group: { _id: null, v: { $sum: SPENDABLE_DELTA_EXPR } } },
        ],
        savings: [
          { $match: { type: { $in: ["savings_deposit", "savings_withdrawal"] }, date: { $lte: asOf } } },
          {
            $group: {
              _id: null,
              v: { $sum: { $cond: [{ $eq: ["$type", "savings_deposit"] }, "$amount", { $multiply: ["$amount", -1] }] } },
            },
          },
        ],
        pending: [
          { $match: { status: "pending" } },
          { $group: { _id: null, v: { $sum: "$amount" }, n: { $sum: 1 } } },
        ],
      },
    },
  ]);
  return {
    spendable: res?.spendable[0]?.v ?? 0,
    savings: res?.savings[0]?.v ?? 0,
    pendingTotal: res?.pending[0]?.v ?? 0,
    pendingCount: res?.pending[0]?.n ?? 0,
  };
}

/** Physical balance per account. Savings deposits move money to the goal's linked account, if any. */
export async function getAccountBalances(userId: string): Promise<Map<string, number>> {
  await connectDB();
  const uid = oid(userId);
  const [groups, goals] = await Promise.all([
    Transaction.aggregate<{ _id: { type: string; a: Types.ObjectId | null; to: Types.ObjectId | null; g: Types.ObjectId | null }; v: number }>([
      { $match: { userId: uid, status: "paid" } },
      { $group: { _id: { type: "$type", a: "$accountId", to: "$toAccountId", g: "$goalId" }, v: { $sum: "$amount" } } },
    ]),
    SavingsGoal.find({ userId: uid }, { accountId: 1 }).lean(),
  ]);
  const goalAccount = new Map(goals.map((g) => [g._id.toString(), g.accountId?.toString() ?? null]));
  const bal = new Map<string, number>();
  const add = (acc: string | null | undefined, v: number) => {
    if (!acc) return;
    bal.set(acc, (bal.get(acc) ?? 0) + v);
  };
  for (const { _id, v } of groups) {
    const a = _id.a?.toString();
    switch (_id.type) {
      case "income":
        add(a, v);
        break;
      case "expense":
        add(a, -v);
        break;
      case "transfer":
        add(a, -v);
        add(_id.to?.toString(), v);
        break;
      case "savings_deposit": {
        const target = _id.g ? goalAccount.get(_id.g.toString()) : null;
        if (target && target !== a) {
          add(a, -v);
          add(target, v);
        }
        break;
      }
      case "savings_withdrawal": {
        const holder = _id.g ? goalAccount.get(_id.g.toString()) : null;
        if (holder && holder !== a) {
          add(holder, -v);
          add(a, v);
        }
        break;
      }
    }
  }
  return bal;
}

/* ------------------------------------------------------------------ Period reports */

export interface CategoryTotal {
  id: string;
  name: string;
  total: number;
  children: { id: string; name: string; total: number }[];
}

export interface PeriodReport {
  from: string;
  to: string;
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
  totalOutflows: number;
  closingBalance: number;
  pendingTotal: number;
  categories: CategoryTotal[];
  daily: { date: string; total: number }[];
  transactions: TxnDTO[];
}

export interface ReportFilters {
  /** "payment" groups spending by payment date; "attribution" by the month it belongs to. */
  basis?: "payment" | "attribution";
  categoryId?: string;
  personId?: string;
  status?: "paid" | "pending";
}

interface ExpenseLine {
  categoryId: string | null;
  amount: number;
}

/** Split an expense into reporting lines. Breakdown items replace the parent — never both. */
export function expenseLines(t: Pick<TransactionDoc, "amount" | "categoryId" | "items">): ExpenseLine[] {
  if (t.items && t.items.length > 0) {
    return t.items.map((i) => ({
      categoryId: (i.categoryId ?? t.categoryId)?.toString() ?? null,
      amount: i.amount,
    }));
  }
  return [{ categoryId: t.categoryId?.toString() ?? null, amount: t.amount }];
}

export function groupByCategory(lines: ExpenseLine[], lookups: Lookups): CategoryTotal[] {
  const cats = categoryMap(lookups);
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

function isInvestment(t: Pick<TransactionDoc, "categoryId">, lookups: Lookups): boolean {
  if (!t.categoryId) return false;
  return categoryMap(lookups).get(t.categoryId.toString())?.nature === "saving";
}

export async function openingBalance(userId: string, beforeDate: string): Promise<number> {
  const [res] = await Transaction.aggregate<{ v: number }>([
    { $match: { userId: oid(userId), status: "paid", date: { $lt: beforeDate } } },
    { $group: { _id: null, v: { $sum: SPENDABLE_DELTA_EXPR } } },
  ]);
  return res?.v ?? 0;
}

export async function getPeriodReport(
  userId: string,
  from: string,
  to: string,
  filters: ReportFilters = {},
  lookups?: Lookups,
): Promise<PeriodReport> {
  await connectDB();
  const uid = oid(userId);
  const lk = lookups ?? (await getLookups(userId));

  const [opening, txns] = await Promise.all([
    openingBalance(userId, from),
    Transaction.find({ userId: uid, date: { $gte: from, $lte: to } }).sort({ date: 1, createdAt: 1 }).lean(),
  ]);

  let salary = 0, additionalIncome = 0, broughtIn = 0, expenses = 0, investments = 0;
  let savingsDeposits = 0, savingsWithdrawals = 0, pendingTotal = 0;
  const daily = new Map<string, number>();

  for (const t of txns) {
    if (t.status === "pending") {
      pendingTotal += t.amount;
      continue;
    }
    switch (t.type) {
      case "income":
        if (t.income?.kind === "salary") salary += t.amount;
        else if (t.income?.kind === "opening") broughtIn += t.amount;
        else additionalIncome += t.amount;
        break;
      case "expense":
        if (isInvestment(t, lk)) investments += t.amount;
        else expenses += t.amount;
        daily.set(t.date, (daily.get(t.date) ?? 0) + t.amount);
        break;
      case "savings_deposit":
        savingsDeposits += t.amount;
        break;
      case "savings_withdrawal":
        savingsWithdrawals += t.amount;
        break;
    }
  }

  const totalIncome = salary + additionalIncome;
  const totalAvailable = opening + totalIncome + broughtIn;
  const savingsAndTransfers = investments + savingsDeposits - savingsWithdrawals;
  const totalOutflows = expenses + savingsAndTransfers;

  // Category breakdown and listed transactions honour the filters; balances above never do.
  let spendSource = txns;
  if (filters.basis === "attribution") {
    spendSource = await Transaction.find({
      userId: uid,
      type: "expense",
      attributionMonth: { $gte: monthOf(from), $lte: monthOf(to) },
    })
      .sort({ date: 1, createdAt: 1 })
      .lean();
  }
  const catIds = filters.categoryId ? new Set(categoryWithChildren(lk, filters.categoryId)) : null;
  const statusWanted = filters.status ?? "paid";
  const lines: ExpenseLine[] = [];
  const listed: typeof txns = [];
  for (const t of spendSource) {
    if (filters.personId && t.personId?.toString() !== filters.personId) continue;
    if (t.type === "expense") {
      const own = expenseLines(t).filter((l) => !catIds || (l.categoryId && catIds.has(l.categoryId)));
      if (catIds && own.length === 0) continue;
      if (t.status === statusWanted) lines.push(...own);
    } else if (catIds) {
      continue;
    }
    if (filters.status && t.status !== filters.status) continue;
    listed.push(t);
  }

  return {
    from,
    to,
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
    totalOutflows,
    closingBalance: totalAvailable - totalOutflows,
    pendingTotal,
    categories: groupByCategory(lines, lk),
    daily: [...daily.entries()].map(([date, total]) => ({ date, total })),
    transactions: listed.map((t) => toTxnDTO(t, lk)),
  };
}

export function getMonthReport(userId: string, month: string, filters?: ReportFilters, lookups?: Lookups) {
  return getPeriodReport(userId, monthStart(month), monthEnd(month), filters, lookups);
}

export interface MonthlyPoint {
  month: string;
  income: number;
  expenses: number;
  saved: number;
}

/** Income vs. outflow per calendar month for the last `count` months, ending at `endMonth`. */
export async function getMonthlySeries(userId: string, endMonth: string, count = 6): Promise<MonthlyPoint[]> {
  await connectDB();
  const startMonth = addMonths(endMonth, -(count - 1));
  const rows = await Transaction.aggregate<{ _id: { m: string; type: string; kind: string | null }; v: number }>([
    { $match: { userId: oid(userId), status: "paid", date: { $gte: monthStart(startMonth), $lte: monthEnd(endMonth) } } },
    { $group: { _id: { m: { $substrBytes: ["$date", 0, 7] }, type: "$type", kind: "$income.kind" }, v: { $sum: "$amount" } } },
  ]);
  const points = new Map<string, MonthlyPoint>();
  for (let m = startMonth; m <= endMonth; m = addMonths(m, 1)) points.set(m, { month: m, income: 0, expenses: 0, saved: 0 });
  for (const r of rows) {
    const p = points.get(r._id.m);
    if (!p) continue;
    if (r._id.type === "income" && r._id.kind !== "opening") p.income += r.v;
    else if (r._id.type === "expense") p.expenses += r.v;
    else if (r._id.type === "savings_deposit") p.saved += r.v;
    else if (r._id.type === "savings_withdrawal") p.saved -= r.v;
  }
  return [...points.values()];
}

export interface MonthSummary {
  month: string;
  opening: number;
  income: number;
  outflows: number;
  closing: number;
}

/** Opening → closing chain for a run of months, from one aggregate (closing(m) = opening(m+1)). */
export async function getMonthSummaries(userId: string, fromMonth: string, toMonth: string): Promise<MonthSummary[]> {
  await connectDB();
  const [opening, rows] = await Promise.all([
    openingBalance(userId, monthStart(fromMonth)),
    Transaction.aggregate<{ _id: string; inflow: number; outflow: number }>([
      { $match: { userId: oid(userId), status: "paid", date: { $gte: monthStart(fromMonth), $lte: monthEnd(toMonth) } } },
      { $addFields: { d: SPENDABLE_DELTA_EXPR } },
      {
        $group: {
          _id: { $substrBytes: ["$date", 0, 7] },
          inflow: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$d", 0] } },
          outflow: { $sum: { $cond: [{ $ne: ["$type", "income"] }, { $multiply: ["$d", -1] }, 0] } },
        },
      },
    ]),
  ]);
  const byMonth = new Map(rows.map((r) => [r._id, r]));
  const out: MonthSummary[] = [];
  let running = opening;
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) {
    const r = byMonth.get(m);
    const income = r?.inflow ?? 0;
    const outflows = r?.outflow ?? 0;
    out.push({ month: m, opening: running, income, outflows, closing: running + income - outflows });
    running += income - outflows;
  }
  return out;
}
