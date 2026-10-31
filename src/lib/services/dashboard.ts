import { connectDB } from "../db/connect";
import { Transaction, oid } from "../db/models";
import { addDays, monthOf, monthStart, todayISO } from "../dates";
import { expenseLines, getBalanceSummary, getMonthlySeries, getPeriodReport } from "./finance";
import { currentCycle, getFundingSources, getSalaryCycles } from "./salary";
import { getUpcomingBills } from "./bills";
import { listGoals } from "./savings";
import { listTransactions, toTxnDTO } from "./transactions";
import { getPersonDetail, listPeople } from "./people";
import { categoryMap, getLookups, type Lookups } from "./lookups";

/**
 * Everything the dashboard shows, computed from database records in one pass.
 *
 * The month figures run from the 1st up to today, so they always add up exactly to the
 * money available right now:
 *   available now = carried forward + income this month − spent − saved/invested
 * (Smart alerts live in the notification bell — see alert-feed.ts.)
 */
export async function getDashboard(userId: string) {
  await connectDB();
  const today = todayISO();
  const month = monthOf(today);

  const lookups = await getLookups(userId);
  const [balance, mtd, cycles, sources, series, upcoming, recent, pendingDocs, goals, invested, borrowed] = await Promise.all([
    getBalanceSummary(userId, today),
    getPeriodReport(userId, monthStart(month), today, {}, lookups),
    getSalaryCycles(userId),
    getFundingSources(userId),
    getMonthlySeries(userId, month, 6),
    getUpcomingBills(userId, today),
    listTransactions(userId, { pageSize: 8 }, lookups),
    Transaction.find({ userId: oid(userId), status: "pending" }).sort({ date: 1 }).limit(8).lean(),
    listGoals(userId, today),
    getInvestedTotal(userId, lookups),
    getBorrowedOverview(userId),
  ]);

  // Salary overview from the FIFO funding ledger.
  const cycle = currentCycle(cycles, today);
  const salaryIdx = cycle ? sources.findIndex((s) => s.id === cycle.salaryId) : -1;
  const currentSalary = salaryIdx >= 0 ? sources[salaryIdx] : null;
  const previousSavings = sources.slice(0, Math.max(0, salaryIdx)).reduce((s, r) => s + r.remaining, 0);
  const totalAvailableFunds = sources.reduce((s, r) => s + r.remaining, 0);
  const salaryBreakdown = sources
    .filter((s) => s.kind === "salary" || s.remaining > 0)
    .slice(-6)
    .reverse();

  // Daily spending for every day of the month so far.
  const dailyMap = new Map(mtd.daily.map((d) => [d.date, d.total]));
  const daily: { date: string; total: number }[] = [];
  for (let d = monthStart(month); d <= today; d = addDays(d, 1)) {
    daily.push({ date: d, total: dailyMap.get(d) ?? 0 });
  }

  return {
    today,
    month,
    metrics: {
      /** The one number that matters: money you can spend right now. */
      availableNow: mtd.closingBalance,
      carriedForward: mtd.openingBalance,
      incomeThisMonth: mtd.totalIncome + mtd.broughtIn,
      spentThisMonth: mtd.expenses,
      savedThisMonth: mtd.savingsAndTransfers,
      /** Set aside outside spendable money: savings-goal funds + money invested (all time). */
      inSavings: balance.savings + invested,
      savingsGoals: balance.savings,
      invested,
      pendingTotal: balance.pendingTotal,
      pendingCount: balance.pendingCount,
    },
    borrowed,
    salary: {
      cycle,
      currentSalary,
      previousSavings,
      totalAvailableFunds,
      currentSalaryRemaining: currentSalary?.remaining ?? 0,
      spentThisCycle: cycle?.totalSpent ?? 0,
      totalAccumulated: previousSavings + balance.savings,
      breakdown: salaryBreakdown,
    },
    categories: mtd.categories,
    daily,
    series,
    recent: recent.rows,
    pending: pendingDocs.map((p) => toTxnDTO(p, lookups)),
    upcoming,
    goals: goals.filter((g) => g.status === "active"),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

/** All-time paid spending in "Investment / saving" categories (e.g. Alwin Investment). */
async function getInvestedTotal(userId: string, lookups: Lookups): Promise<number> {
  const cats = categoryMap(lookups);
  const savingIds = lookups.categories.filter((c) => c.nature === "saving").map((c) => oid(c.id));
  if (savingIds.length === 0) return 0;
  const docs = await Transaction.find(
    { userId: oid(userId), type: "expense", status: "paid", $or: [{ categoryId: { $in: savingIds } }, { "items.categoryId": { $in: savingIds } }] },
    { amount: 1, categoryId: 1, items: 1 },
  ).lean();
  let total = 0;
  for (const t of docs) {
    for (const line of expenseLines(t)) {
      if (line.categoryId && cats.get(line.categoryId)?.nature === "saving") total += line.amount;
    }
  }
  return total;
}

/**
 * Money owed to family, reusing Family & Allocations: what was agreed (allocated), what has
 * been paid back (payments linked to the person), and what is still outstanding.
 */
async function getBorrowedOverview(userId: string) {
  const people = (await listPeople(userId)).filter((p) => p.totalAllocated > 0);
  const details = await Promise.all(people.map((p) => getPersonDetail(userId, p.id)));
  const byPerson = people.map((p, i) => {
    const open = (details[i]?.allocations ?? [])
      .filter((a) => a.remaining > 0)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((a) => ({ month: a.month, remaining: a.remaining, note: a.note }));
    return { id: p.id, name: p.name, borrowed: p.totalAllocated, repaid: p.totalPaid, remaining: Math.max(0, p.totalAllocated - p.totalPaid), open };
  });
  const total = byPerson.reduce((s, p) => s + p.borrowed, 0);
  const repaid = byPerson.reduce((s, p) => s + Math.min(p.repaid, p.borrowed), 0);
  return { total, repaid, remaining: total - repaid, byPerson };
}
