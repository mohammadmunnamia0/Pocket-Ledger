import type { Priority } from "../constants";
import type { AlertPrefs } from "../db/models";
import { formatTaka, percent, roundDownTaka } from "../money";
import { formatDate, formatMonthLong } from "../dates";

/**
 * Smart financial alerts — pure functions over real figures. Each alert has a stable key
 * scoped to its period (month / salary cycle), so a dismissed alert stays dismissed until
 * the situation genuinely recurs in a new period.
 */

export { ALERT_TYPES, type AlertType } from "./types";
import type { AlertType } from "./types";

export interface Alert {
  key: string;
  type: AlertType;
  priority: Priority;
  icon: string;
  title: string;
  message: string;
  amount?: number;
  action?: { label: string; href: string };
}

export interface AlertGoal {
  id: string;
  name: string;
  kind: string;
  status: string;
  balance: number;
  targetAmount: number;
  monthlyTarget: number;
  thisMonthDeposits: number;
}

export interface AlertContext {
  today: string;
  month: string;
  spendable: number;
  pendingTotal: number;
  upcomingBillsTotal: number;
  upcomingBillsCount: number;
  nextBill: { title: string; dueDate: string } | null;
  familyOpen: { personName: string; remaining: number }[];
  cycle: { label: string; start: string; totalAvailable: number; totalSpent: number } | null;
  /** Month-to-date spending per top category vs. the same days last month. */
  categoryCompare: { name: string; current: number; previous: number }[];
  goals: AlertGoal[];
  lastMonth: { month: string; saved: number } | null;
  prefs: AlertPrefs;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function isEnabled(prefs: AlertPrefs, type: AlertType): boolean {
  return prefs.enabled?.[type] !== false;
}

/** Money that is genuinely free: after pending payments, upcoming bills, family commitments and the safety buffer. */
export function freeToSave(ctx: AlertContext): number {
  const family = ctx.familyOpen.reduce((s, f) => s + f.remaining, 0);
  return ctx.spendable - ctx.pendingTotal - ctx.upcomingBillsTotal - family - ctx.prefs.minBalance;
}

export function buildAlerts(ctx: AlertContext): Alert[] {
  const alerts: Alert[] = [];
  const { month, prefs } = ctx;
  const commitments = ctx.pendingTotal + ctx.upcomingBillsTotal;

  if (isEnabled(prefs, "low_balance")) {
    if (commitments > 0 && ctx.spendable < commitments) {
      alerts.push({
        key: `low_balance:cover:${month}`,
        type: "low_balance",
        priority: "high",
        icon: "⚠️",
        title: "Not enough to cover commitments",
        message: `Pending payments and upcoming bills total ${formatTaka(commitments)}, but only ${formatTaka(ctx.spendable)} is available.`,
        amount: commitments - ctx.spendable,
        action: { label: "Review pending", href: "/transactions?status=pending" },
      });
    } else if (ctx.spendable < prefs.minBalance) {
      alerts.push({
        key: `low_balance:min:${month}`,
        type: "low_balance",
        priority: "high",
        icon: "⚠️",
        title: "Balance below your minimum",
        message: `Your available balance is ${formatTaka(ctx.spendable)}, below your ${formatTaka(prefs.minBalance)} safety level.`,
        amount: ctx.spendable,
        action: { label: "Review expenses", href: "/transactions?type=expense" },
      });
    }
  }

  if (isEnabled(prefs, "bills") && ctx.upcomingBillsCount > 0 && ctx.spendable >= commitments) {
    alerts.push({
      key: `bills:${month}:${ctx.upcomingBillsCount}`,
      type: "bills",
      priority: "medium",
      icon: "📅",
      title: "Upcoming utility bills",
      message:
        `${ctx.upcomingBillsCount} bill${ctx.upcomingBillsCount > 1 ? "s" : ""} estimated at ${formatTaka(ctx.upcomingBillsTotal)}` +
        (ctx.nextBill ? ` — next: ${ctx.nextBill.title} on ${formatDate(ctx.nextBill.dueDate)}` : "") +
        ". Keep this amount available.",
      amount: ctx.upcomingBillsTotal,
      action: { label: "View bills", href: "/bills" },
    });
  }

  if (isEnabled(prefs, "high_spend") && ctx.cycle && ctx.cycle.totalAvailable > 0) {
    const pct = percent(ctx.cycle.totalSpent, ctx.cycle.totalAvailable);
    if (pct >= prefs.spendWarnPct) {
      const severe = pct >= 90;
      alerts.push({
        key: `high_spend:${ctx.cycle.start}:${severe ? "90" : prefs.spendWarnPct}`,
        type: "high_spend",
        priority: severe ? "high" : "medium",
        icon: "📉",
        title: `${pct}% of this salary cycle spent`,
        message: `Since ${ctx.cycle.label} arrived on ${formatDate(ctx.cycle.start)} you have spent ${formatTaka(ctx.cycle.totalSpent)} of ${formatTaka(ctx.cycle.totalAvailable)}. Consider limiting non-essential expenses until your next salary.`,
        amount: ctx.cycle.totalSpent,
        action: { label: "Review expenses", href: "/transactions?type=expense" },
      });
    }
  }

  if (isEnabled(prefs, "category_increase")) {
    const rising = ctx.categoryCompare
      .filter((c) => c.previous > 0 && c.current - c.previous >= 50000 && c.current * 100 >= c.previous * 125)
      .sort((a, b) => b.current - b.previous - (a.current - a.previous))
      .slice(0, 2);
    for (const c of rising) {
      alerts.push({
        key: `category_increase:${month}:${c.name}`,
        type: "category_increase",
        priority: "medium",
        icon: "📈",
        title: `${c.name} spending is up`,
        message: `${formatTaka(c.current)} so far this month vs ${formatTaka(c.previous)} over the same days last month (+${percent(c.current - c.previous, c.previous)}%).`,
        amount: c.current - c.previous,
        action: { label: "See report", href: "/reports" },
      });
    }
  }

  if (isEnabled(prefs, "medical")) {
    const medical = ctx.goals.find((g) => g.kind === "medical" && g.status !== "paused");
    if (!medical) {
      alerts.push({
        key: `medical:none:${month}`,
        type: "medical",
        priority: "low",
        icon: "🏥",
        title: "No medical emergency fund yet",
        message: "Medical emergencies can create sudden pressure. Consider setting up a separate Medical Emergency Fund with a target.",
        action: { label: "Create fund", href: "/savings?new=medical" },
      });
    } else if (medical.balance < medical.targetAmount) {
      const pct = percent(medical.balance, medical.targetAmount);
      alerts.push({
        key: `medical:${medical.id}:${month}`,
        type: "medical",
        priority: pct < 25 ? "high" : "medium",
        icon: "🏥",
        title: "Medical Emergency Fund",
        message: `Your medical reserve is ${formatTaka(medical.balance)} of a ${formatTaka(medical.targetAmount)} target (${pct}%). Consider a small contribution from your available salary.`,
        amount: medical.balance,
        action: { label: "View savings goal", href: `/savings/${medical.id}` },
      });
    }
  }

  if (isEnabled(prefs, "savings_opportunity")) {
    const free = freeToSave(ctx);
    if (free >= 100000) {
      const active = ctx.goals.filter((g) => g.status === "active");
      const monthlyGap = active.reduce((s, g) => s + Math.max(0, g.monthlyTarget - g.thisMonthDeposits), 0);
      const tenth = roundDownTaka(free / 10, 100);
      const suggestion = monthlyGap > 0 ? Math.min(roundDownTaka(monthlyGap, 100) || tenth, roundDownTaka(free / 2, 100)) : tenth;
      if (suggestion >= 10000) {
        alerts.push({
          key: `savings_opportunity:${month}`,
          type: "savings_opportunity",
          priority: "medium",
          icon: "💰",
          title: "Savings opportunity",
          message: `You have ${formatTaka(free + ctx.prefs.minBalance)} available after upcoming commitments${ctx.prefs.minBalance ? ` (keeping ${formatTaka(ctx.prefs.minBalance)} as a buffer)` : ""}. Consider saving ${formatTaka(suggestion)}.`,
          amount: suggestion,
          action: { label: "Add to savings", href: "/savings" },
        });
      }
    }
  }

  if (isEnabled(prefs, "goal_progress")) {
    for (const g of ctx.goals.filter((x) => x.status === "active")) {
      const pct = percent(g.balance, g.targetAmount);
      if (pct >= 80 && pct < 100) {
        alerts.push({
          key: `goal_progress:${g.id}:${month}`,
          type: "goal_progress",
          priority: "low",
          icon: "🎯",
          title: `${g.name} is ${pct}% funded`,
          message: `Only ${formatTaka(g.targetAmount - g.balance)} left to reach your target.`,
          amount: g.targetAmount - g.balance,
          action: { label: "View goal", href: `/savings/${g.id}` },
        });
      } else if (g.monthlyTarget > 0 && g.thisMonthDeposits < g.monthlyTarget && g.thisMonthDeposits * 100 >= g.monthlyTarget * 75) {
        alerts.push({
          key: `goal_progress:monthly:${g.id}:${month}`,
          type: "goal_progress",
          priority: "low",
          icon: "🎯",
          title: "Close to this month's savings target",
          message: `${formatTaka(g.thisMonthDeposits)} of ${formatTaka(g.monthlyTarget)} saved to ${g.name} this month.`,
          amount: g.monthlyTarget - g.thisMonthDeposits,
          action: { label: "View goal", href: `/savings/${g.id}` },
        });
      }
    }
  }

  if (isEnabled(prefs, "achievement") && ctx.lastMonth && ctx.lastMonth.saved > 0) {
    alerts.push({
      key: `achievement:${ctx.lastMonth.month}`,
      type: "achievement",
      priority: "low",
      icon: "🎉",
      title: "Savings are growing",
      message: `You saved ${formatTaka(ctx.lastMonth.saved)} in ${formatMonthLong(ctx.lastMonth.month)}. Well done.`,
      amount: ctx.lastMonth.saved,
    });
  }

  if (isEnabled(prefs, "family_reserve") && ctx.familyOpen.length > 0) {
    const total = ctx.familyOpen.reduce((s, f) => s + f.remaining, 0);
    alerts.push({
      key: `family_reserve:${month}`,
      type: "family_reserve",
      priority: "medium",
      icon: "❤️",
      title: "Family allocations still to pay",
      message: `Keep ${formatTaka(total)} reserved for ${ctx.familyOpen.map((f) => `${f.personName} (${formatTaka(f.remaining)})`).join(", ")} this month.`,
      amount: total,
      action: { label: "View allocations", href: "/people" },
    });
  }

  if (isEnabled(prefs, "savings_reminder") && prefs.savingsReminderDay > 0) {
    const day = Number(ctx.today.slice(8, 10));
    const active = ctx.goals.filter((g) => g.status === "active");
    if (day >= prefs.savingsReminderDay && active.length > 0 && active.every((g) => g.thisMonthDeposits === 0)) {
      alerts.push({
        key: `savings_reminder:${month}`,
        type: "savings_reminder",
        priority: "medium",
        icon: "🔔",
        title: "Monthly savings reminder",
        message: `You haven't added to any savings goal in ${formatMonthLong(month)} yet.`,
        action: { label: "Add to savings", href: "/savings" },
      });
    }
  }

  return alerts.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}
