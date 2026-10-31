import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock, Wallet } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { CardsSkeleton, EmptyState, Meter, PageHeader, Section, StatCard, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { TxnList } from "@/components/txn-list";
import { AlertList } from "@/components/alert-list";
import { HelpButton } from "@/components/help";
import { CategoryBarChart, DailySpendChart, IncomeExpenseChart } from "@/components/charts";
import { requireUser } from "@/lib/auth/session";
import { getDashboard } from "@/lib/services/dashboard";
import { formatDate, formatMonthLong } from "@/lib/dates";
import { formatTaka, percent } from "@/lib/money";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        help="dashboard"
        description="Your money at a glance — every figure is calculated from your recorded transactions."
        actions={
          <ButtonLink href="/income" variant="outline">
            <Wallet /> Add salary
          </ButtonLink>
        }
      />
      <Suspense
        fallback={
          <div className="space-y-4">
            <CardsSkeleton count={8} />
            <TableSkeleton rows={8} />
          </div>
        }
      >
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  const user = await requireUser();
  const d = await getDashboard(user.id);
  const m = d.metrics;
  const s = d.salary;

  return (
    <div className="space-y-5">
      {d.alerts.length > 0 && (
        <Section
          title="Smart Financial Alerts"
          help="smartAlerts"
          description="Based on your balance, commitments and spending"
          actions={
            <Link href="/alerts" className="text-xs text-muted-foreground hover:text-foreground">
              History & settings
            </Link>
          }
        >
          <AlertList alerts={d.alerts} />
        </Section>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_2fr]">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-1">
            <p className="text-xs font-medium text-muted-foreground">Remaining balance · {formatMonthLong(d.month)}</p>
            <HelpButton topic="balanceCard" className="size-5" />
          </div>
          <p className="mt-1 text-3xl font-semibold tracking-tight">
            <Money value={m.remaining} tone="auto" />
          </p>
          <dl className="mt-4 grid gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Carried forward</dt>
              <dd>
                <Money value={m.openingBalance} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">+ Income this month</dt>
              <dd>
                <Money value={m.totalIncome} tone="income" />
              </dd>
            </div>
            <div className="flex justify-between border-t pt-1.5 font-medium">
              <dt>Total available</dt>
              <dd>
                <Money value={m.totalAvailable} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">− Spent & saved this month</dt>
              <dd>
                <Money value={m.totalAvailable - m.remaining} />
              </dd>
            </div>
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Total available balance" value={<Money value={m.totalAvailable} />} hint="Carried forward + this month's income" />
          <StatCard label="This month's salary" value={<Money value={m.currentMonthSalary} />} />
          <StatCard label="Total income" value={<Money value={m.totalIncome} />} hint="This month" />
          <StatCard label="Total expenses" value={<Money value={m.totalExpenses} />} hint={`Today: ${formatTaka(m.todaySpent)}`} />
          <StatCard label="Total savings" value={<Money value={m.totalSavings} />} hint="Held in savings goals" />
          <StatCard
            label="Pending payments"
            value={<Money value={m.pendingTotal} />}
            hint={m.pendingCount ? `${m.pendingCount} not yet paid` : "Nothing pending"}
          />
        </div>
      </div>

      <Section
        title="Salary carry-forward"
        help="carryForward"
        description={
          s.cycle
            ? `Current cycle: ${s.cycle.label}, received ${formatDate(s.cycle.start)}. Expenses use the oldest salary first.`
            : "Add your salary to start tracking how each salary is spent."
        }
        actions={
          <Link href="/income" className="text-xs text-muted-foreground hover:text-foreground">
            Salary records
          </Link>
        }
      >
        {s.breakdown.length === 0 ? (
          <EmptyState
            title="No salary recorded yet"
            description="Record a salary to see carry-forward and salary-wise spending."
            action={<ButtonLink href="/income">Add salary</ButtonLink>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Metric label="Previous salary savings" value={s.previousSavings} />
              <Metric label="Current salary received" value={s.currentSalary?.amount ?? 0} />
              <Metric label="Total available funds" value={s.totalAvailableFunds} />
              <Metric label="Spent this salary cycle" value={s.spentThisCycle} />
              <Metric label="Current salary remaining" value={s.currentSalaryRemaining} />
              <Metric label="Total accumulated savings" value={s.totalAccumulated} hint="Unspent older salaries + savings goals" />
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Salary</th>
                    <th className="pb-2 text-right font-medium">Original</th>
                    <th className="pb-2 text-right font-medium">Used</th>
                    <th className="pb-2 text-right font-medium">Remaining</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {s.breakdown.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 pr-2">
                        <Link href={`/income/${r.id}`} className="font-medium hover:underline">
                          {r.label}
                        </Link>
                        <Meter value={r.used} max={r.amount} className="mt-1.5 h-1.5 max-w-40" label={`${percent(r.used, r.amount)}% used`} />
                      </td>
                      <td className="py-2 text-right">{formatTaka(r.amount)}</td>
                      <td className="py-2 text-right">{formatTaka(r.used)}</td>
                      <td className="py-2 text-right font-medium">{formatTaka(r.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Daily spending" help="charts" description={formatMonthLong(d.month)}>
          {d.daily.some((x) => x.total > 0) ? <DailySpendChart data={d.daily} /> : <EmptyState title="No expenses yet this month" />}
        </Section>
        <Section title="Spending by category" help="charts" description={formatMonthLong(d.month)}>
          {d.categories.length ? <CategoryBarChart data={d.categories} /> : <EmptyState title="No categorized spending yet" />}
        </Section>
      </div>

      <Section title="Income vs. expenses" help="charts" description="Last 6 months">
        <IncomeExpenseChart data={d.series} />
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section
          title="Recent transactions"
          help="transactions"
          actions={
            <Link href="/transactions" className="text-xs text-muted-foreground hover:text-foreground">
              View all
            </Link>
          }
        >
          {d.recent.length ? <TxnList items={d.recent} /> : <EmptyState title="No transactions yet" description="Use Quick Add to record your first expense." />}
        </Section>
        <Section title="Upcoming bills & pending payments" help="upcomingBills">
          {d.upcoming.length === 0 && d.pending.length === 0 ? (
            <EmptyState title="Nothing due" description="Set up recurring bills to get reminders." action={<ButtonLink href="/bills" variant="outline">Utility bills</ButtonLink>} />
          ) : (
            <div className="space-y-4">
              {d.upcoming.length > 0 && (
                <ul className="divide-y">
                  {d.upcoming.slice(0, 5).map((b) => (
                    <li key={`${b.recurringBillId}-${b.billingMonth}`} className="flex items-center gap-3 py-2.5">
                      <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                        <CalendarClock className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{b.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.daysLeft < 0 ? `Overdue by ${-b.daysLeft} days` : b.daysLeft === 0 ? "Due today" : `Due ${formatDate(b.dueDate)} · ${b.daysLeft} days`}
                        </p>
                      </div>
                      <Money value={b.expectedAmount} className="text-sm" />
                    </li>
                  ))}
                </ul>
              )}
              {d.pending.length > 0 && <TxnList items={d.pending} />}
            </div>
          )}
        </Section>
      </div>

      {d.goals.length > 0 && (
        <Section
          title="Savings goals"
          help="savings"
          actions={
            <Link href="/savings" className="text-xs text-muted-foreground hover:text-foreground">
              Manage
            </Link>
          }
        >
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.goals.map((g) => (
              <li key={g.id}>
                <Link href={`/savings/${g.id}`} className="block rounded-lg p-1 hover:bg-muted/50">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted-foreground">{g.progressPct}%</span>
                  </div>
                  <Meter value={g.balance} max={g.targetAmount} className="mt-2" label={`${g.name} progress`} />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatTaka(g.balance)} of {formatTaka(g.targetAmount)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold">
        <Money value={value} />
      </dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
