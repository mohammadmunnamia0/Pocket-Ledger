import { addMonths, daysInMonth, monthOf, monthStart, monthEnd, todayISO } from "../dates";
import { buildAlerts } from "../alerts/rules";
import { getLookups } from "./lookups";
import { getBalanceSummary, getPeriodReport } from "./finance";
import { currentCycle, getSalaryCycles } from "./salary";
import { getUpcomingBills } from "./bills";
import { listGoals } from "./savings";
import { getOpenAllocationsForMonth } from "./people";
import { getAlertPrefs, syncAlerts, type ShownAlert } from "./alerts";

/**
 * Smart alerts for the notification bell. Built from live figures each time the app
 * shell renders (and after every change), then filtered by read/dismissed state.
 */
export async function getActiveAlerts(userId: string): Promise<ShownAlert[]> {
  const today = todayISO();
  const month = monthOf(today);
  const lastMonth = addMonths(month, -1);
  const sameDayLastMonth = `${lastMonth}-${String(Math.min(Number(today.slice(8)), daysInMonth(lastMonth))).padStart(2, "0")}`;

  const lookups = await getLookups(userId);
  const [balance, thisMonth, lastMonthToDate, lastMonthFull, cycles, upcoming, goals, familyOpen, prefs] = await Promise.all([
    getBalanceSummary(userId, today),
    getPeriodReport(userId, monthStart(month), today, {}, lookups),
    getPeriodReport(userId, monthStart(lastMonth), sameDayLastMonth, {}, lookups),
    getPeriodReport(userId, monthStart(lastMonth), monthEnd(lastMonth), {}, lookups),
    getSalaryCycles(userId),
    getUpcomingBills(userId, today),
    listGoals(userId, today),
    getOpenAllocationsForMonth(userId, month),
    getAlertPrefs(userId),
  ]);

  const cycle = currentCycle(cycles, today);
  const dueSoon = upcoming.filter((b) => b.daysLeft <= 31);

  const alerts = buildAlerts({
    today,
    month,
    spendable: balance.spendable,
    pendingTotal: balance.pendingTotal,
    upcomingBillsTotal: dueSoon.reduce((s, b) => s + b.expectedAmount, 0),
    upcomingBillsCount: dueSoon.length,
    nextBill: upcoming[0] ? { title: upcoming[0].title, dueDate: upcoming[0].dueDate } : null,
    familyOpen,
    cycle: cycle ? { label: cycle.label, start: cycle.start, totalAvailable: cycle.totalAvailable, totalSpent: cycle.totalSpent } : null,
    categoryCompare: thisMonth.categories.map((c) => ({
      name: c.name,
      current: c.total,
      previous: lastMonthToDate.categories.find((p) => p.id === c.id)?.total ?? 0,
    })),
    goals,
    lastMonth: { month: lastMonth, saved: lastMonthFull.savingsDeposits - lastMonthFull.savingsWithdrawals },
    prefs,
  });
  return syncAlerts(userId, alerts);
}
