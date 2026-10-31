import { connectDB } from "../db/connect";
import { Transaction, oid } from "../db/models";
import { addDays, monthOf, monthStart, todayISO } from "../dates";
import { getLookups } from "./lookups";
import { getBalanceSummary, getMonthlySeries, getPeriodReport } from "./finance";
import { currentCycle, getFundingSources, getSalaryCycles } from "./salary";
import { getUpcomingBills } from "./bills";
import { listGoals } from "./savings";
import { listTransactions, toTxnDTO } from "./transactions";

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
  const [balance, mtd, cycles, sources, series, upcoming, recent, pendingDocs, goals] = await Promise.all([
    getBalanceSummary(userId, today),
    getPeriodReport(userId, monthStart(month), today, {}, lookups),
    getSalaryCycles(userId),
    getFundingSources(userId),
    getMonthlySeries(userId, month, 6),
    getUpcomingBills(userId, today),
    listTransactions(userId, { pageSize: 8 }, lookups),
    Transaction.find({ userId: oid(userId), status: "pending" }).sort({ date: 1 }).limit(8).lean(),
    listGoals(userId, today),
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
      currentMonthSalary: mtd.salary,
      totalSavings: balance.savings,
      pendingTotal: balance.pendingTotal,
      pendingCount: balance.pendingCount,
      todaySpent: dailyMap.get(today) ?? 0,
    },
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
