import { connectDB } from "../db/connect";
import { Transaction, oid } from "../db/models";
import { addDays, addMonths, daysInMonth, monthEnd, monthOf, monthStart, todayISO } from "../dates";
import { buildAlerts } from "../alerts/rules";
import { getLookups } from "./lookups";
import { getBalanceSummary, getMonthlySeries, getPeriodReport } from "./finance";
import { currentCycle, getFundingSources, getSalaryCycles } from "./salary";
import { getUpcomingBills } from "./bills";
import { listGoals } from "./savings";
import { getOpenAllocationsForMonth } from "./people";
import { getAlertPrefs, syncAlerts } from "./alerts";
import { listTransactions, toTxnDTO } from "./transactions";

/** Everything the dashboard shows, computed from database records in one pass. */
export async function getDashboard(userId: string) {
  await connectDB();
  const today = todayISO();
  const month = monthOf(today);
  const lastMonth = addMonths(month, -1);
  const sameDayLastMonth = `${lastMonth}-${String(Math.min(Number(today.slice(8)), daysInMonth(lastMonth))).padStart(2, "0")}`;

  const lookups = await getLookups(userId);
  const [balance, monthReport, lastMonthToDate, lastMonthFull, cycles, sources, series, upcoming, recent, pendingDocs, goals, familyOpen, prefs] =
    await Promise.all([
      getBalanceSummary(userId, today),
      getPeriodReport(userId, monthStart(month), monthEnd(month), {}, lookups),
      getPeriodReport(userId, monthStart(lastMonth), sameDayLastMonth, {}, lookups),
      getPeriodReport(userId, monthStart(lastMonth), monthEnd(lastMonth), {}, lookups),
      getSalaryCycles(userId),
      getFundingSources(userId),
      getMonthlySeries(userId, month, 6),
      getUpcomingBills(userId, today),
      listTransactions(userId, { pageSize: 8 }, lookups),
      Transaction.find({ userId: oid(userId), status: "pending" }).sort({ date: 1 }).limit(8).lean(),
      listGoals(userId, today),
      getOpenAllocationsForMonth(userId, month),
      getAlertPrefs(userId),
    ]);

  // Month-to-date spending vs. the same days of last month.
  const thisMonthToDate = monthReport.categories;
  const categoryCompare = thisMonthToDate.map((c) => ({
    name: c.name,
    current: c.total,
    previous: lastMonthToDate.categories.find((p) => p.id === c.id)?.total ?? 0,
  }));

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

  const upcomingBillsTotal = upcoming.filter((b) => b.daysLeft <= 31).reduce((s, b) => s + b.expectedAmount, 0);
  const upcomingCount = upcoming.filter((b) => b.daysLeft <= 31).length;

  const alerts = buildAlerts({
    today,
    month,
    spendable: balance.spendable,
    pendingTotal: balance.pendingTotal,
    upcomingBillsTotal,
    upcomingBillsCount: upcomingCount,
    nextBill: upcoming[0] ? { title: upcoming[0].title, dueDate: upcoming[0].dueDate } : null,
    familyOpen,
    cycle: cycle ? { label: cycle.label, start: cycle.start, totalAvailable: cycle.totalAvailable, totalSpent: cycle.totalSpent } : null,
    categoryCompare,
    goals,
    lastMonth: { month: lastMonth, saved: lastMonthFull.savingsDeposits - lastMonthFull.savingsWithdrawals },
    prefs,
  });
  const shownAlerts = await syncAlerts(userId, alerts);

  // Daily spending for every day of the month so far.
  const dailyMap = new Map(monthReport.daily.map((d) => [d.date, d.total]));
  const daily: { date: string; total: number }[] = [];
  for (let d = monthStart(month); d <= today && d <= monthEnd(month); d = addDays(d, 1)) {
    daily.push({ date: d, total: dailyMap.get(d) ?? 0 });
  }

  return {
    today,
    month,
    metrics: {
      totalAvailable: monthReport.totalAvailable,
      openingBalance: monthReport.openingBalance,
      currentMonthSalary: monthReport.salary,
      totalIncome: monthReport.totalIncome + monthReport.broughtIn,
      totalExpenses: monthReport.expenses + monthReport.investments,
      remaining: monthReport.closingBalance,
      spendableNow: balance.spendable,
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
    categories: monthReport.categories,
    daily,
    series,
    recent: recent.rows,
    pending: pendingDocs.map((p) => toTxnDTO(p, lookups)),
    upcoming,
    goals: goals.filter((g) => g.status === "active"),
    alerts: shownAlerts,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
