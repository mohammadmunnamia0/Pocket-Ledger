import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, Wallet } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { CardsSkeleton, EmptyState, Meter, PageHeader, Section, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { TxnList } from "@/components/txn-list";
import { HelpButton } from "@/components/help";
import { HoldingsStrip } from "@/components/holdings-card";
import { RevealCard } from "@/components/reveal-card";
import { CategoryBarChart, DailySpendChart, IncomeExpenseChart } from "@/components/charts";
import { requireUser } from "@/lib/auth/session";
import { getDashboard, type DashboardData } from "@/lib/services/dashboard";
import { cn } from "@/lib/utils";
import { formatDate, formatMonth, formatMonthLong } from "@/lib/dates";
import { formatTaka, percent } from "@/lib/money";

export default function PersonalDashboardPage() {
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
  const p = d.period;
  const s = d.salary;
  const carriedFrom = p?.carriedFrom.length
    ? `Left from ${p.carriedFrom.map((c) => (p.carriedFrom.length > 1 ? `${c.label} (${formatTaka(c.amount)})` : c.label)).join(" + ")}`
    : "Nothing was left from earlier salaries";

  return (
    <div className="space-y-5">
      <section aria-labelledby="period-title">
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <h2 id="period-title" className="text-sm font-semibold">
            {p ? `This salary period · since ${formatDate(p.receivedOn)}` : "This salary period"}
          </h2>
          <HelpButton topic="balanceCard" className="size-5" />
          {p && (
            <Link href="/income/history" className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              Salary history →
            </Link>
          )}
        </div>
        {!p ? (
          <EmptyState
            title="No salary recorded yet"
            description="Add your salary to see what you carried forward, what you received, what you spent and what is left."
            action={<ButtonLink href="/income">Add salary</ButtonLink>}
          />
        ) : (
          // Reads left to right as one sum on desktop; on phones the answer comes first.
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <OverviewCard
              highlight
              className="col-span-2 lg:order-5 lg:col-span-1"
              href="/transactions"
              label="= Remaining balance"
              value={p.remaining}
              hint={`${formatTaka(p.totalAvailable)} available − ${formatTaka(p.spends)} spent · lending & borrowing not included`}
            />
            {/* Right under Remaining balance on phones; a full-width row below the sum on desktop. */}
            <div className="col-span-2 lg:order-6 lg:col-span-5">
              <HoldingsStrip holdings={d.holdings} remaining={p.remaining} owed={d.owed.outstanding} lent={d.lent.outstanding} />
            </div>
            <OverviewCard
              className="lg:order-1"
              href="/income/history"
              label="Previous salary carryforward"
              value={p.carriedIn}
              hint={carriedFrom}
            />
            <RevealCard
              className="lg:order-2"
              href={`/income/${p.salaryId}`}
              label="+ Latest salary"
              value={p.salary}
              hint={`${p.label}, received ${formatDate(p.receivedOn)}${p.otherIncome ? ` · plus ${formatTaka(p.otherIncome)} other income` : ""}`}
            />
            <OverviewCard
              className="lg:order-3"
              href={`/income/history#period-${p.salaryId}`}
              label="= Total available"
              value={p.totalAvailable}
              hint={
                (p.otherIncome ? "Carryforward + salary + other income" : "Carryforward + latest salary") +
                (p.otherInflows ? ` + ${formatTaka(p.otherInflows)} investment capital back (not income)` : "")
              }
            />
            <OverviewCard
              className="lg:order-4"
              href={`/transactions?flow=out&status=paid&from=${p.receivedOn}`}
              label="− Spends this period"
              value={p.spends}
              hint={`${p.paymentCount} payment${p.paymentCount === 1 ? "" : "s"} since ${formatDate(p.receivedOn)}${p.savedOrInvested ? ` · incl. ${formatTaka(p.savedOrInvested)} saved & invested` : ""}`}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="commitments-title">
        <h2 id="commitments-title" className="text-sm font-semibold">
          Loans, savings &amp; investments
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">Kept separate — none of these are part of the Remaining balance or of income and expenses.</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <LoanTotalCard direction="lent" summary={d.lent} />
          <LoanTotalCard direction="borrowed" summary={d.owed} />
          <RevealCard
            href="/savings"
            label="Savings"
            value={m.savingsGoals}
            hint={`In ${d.goals.length} active savings goal${d.goals.length === 1 ? "" : "s"} — not in Remaining balance`}
          />
          <RevealCard href="/investments" label="Investment" value={m.invested} hint="Invested and not yet returned — not in Remaining balance" />
          <OverviewCard
            className="col-span-2 lg:col-span-1"
            href="/transactions?status=pending"
            label="Pending payments"
            value={m.pendingTotal}
            hint={m.pendingCount ? `${m.pendingCount} not paid yet — not deducted` : "Nothing waiting to be paid"}
          />
          <BorrowedCard borrowed={d.borrowed} className="col-span-2 lg:col-span-1" />
        </div>
      </section>

      <Section
        title="Each salary"
        help="carryForward"
        description="How much of every salary has been used and what is left. Spending always uses the oldest salary first."
        actions={
          <Link href="/income/history" className="text-xs text-muted-foreground hover:text-foreground">
            Month-by-month history
          </Link>
        }
      >
        {s.breakdown.length === 0 ? (
          <EmptyState title="No salary recorded yet" action={<ButtonLink href="/income">Add salary</ButtonLink>} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Salary</th>
                  <th className="pb-2 text-right font-medium">Received</th>
                  <th className="pb-2 text-right font-medium">Used</th>
                  <th className="pb-2 text-right font-medium">Left</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {s.breakdown.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-2">
                      <Link href={`/income/${r.id}`} className="font-medium hover:underline">
                        {r.label}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{formatDate(r.date)}</span>
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

function OverviewCard({
  label,
  value,
  hint,
  href,
  highlight = false,
  className,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20",
        highlight && "border-primary/40 bg-primary/5 hover:border-primary/60",
        className,
      )}
    >
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className={cn("mt-1 font-semibold tracking-tight", highlight ? "text-3xl" : "text-xl")}>
        <Money value={value} tone="auto" />
      </span>
      <span className="mt-1 text-xs text-muted-foreground">{hint}</span>
    </Link>
  );
}

/** Always shown: what others still owe you (receivable) or what you still owe (payable). Never part of the Remaining balance. */
function LoanTotalCard({ direction, summary: s, className }: { direction: "lent" | "borrowed"; summary: DashboardData["lent"]; className?: string }) {
  const lent = direction === "lent";
  const people = s.byPerson.slice(0, 2).map((p) => p.person).join(", ");
  const hint =
    s.total === 0
      ? lent
        ? "No money lent yet"
        : "No money borrowed yet"
      : `${lent ? "Lent" : "Borrowed"} ${formatTaka(s.total)} · repaid ${formatTaka(s.repaid)} · ${people || "all repaid"}`;
  return (
    <Link href="/loans" className={cn("group flex min-w-0 flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20", className)}>
      <span className="flex items-start justify-between gap-2 text-xs font-medium text-muted-foreground">
        {lent ? "Total Money Lent (Receivable)" : "Total Money Borrowed (Payable)"}
        <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className="mt-1 text-xl font-semibold tracking-tight tabular">{formatTaka(s.outstanding)}</span>
      <span className="text-xs text-muted-foreground">{lent ? "Others owe you" : "You owe others"}</span>
      <span className="mt-1 text-xs text-muted-foreground">{hint}</span>
    </Link>
  );
}

/** Money owed to family, from Family & Allocations (agreed amount, repaid, outstanding). */
function BorrowedCard({ borrowed, className }: { borrowed: DashboardData["borrowed"]; className?: string }) {
  // "Suraiya: Oct ৳2,500 · Nov ৳2,000 (MUST pay)" — next two open instalments per person.
  const next = borrowed.byPerson
    .filter((p) => p.open.length > 0)
    .map((p) => `${p.name}: ${p.open.slice(0, 2).map((o) => `${formatMonth(o.month).split(" ")[0]} ${formatTaka(o.remaining)}${o.note ? ` (${o.note})` : ""}`).join(" · ")}`);
  return (
    <Link href="/people" className={cn("group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20", className)}>
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        Borrowed money
        <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      {borrowed.total === 0 ? (
        <span className="mt-2 text-xs text-muted-foreground">Nothing owed. Track money you owe in Family &amp; Allocations.</span>
      ) : (
        <>
          <span className="mt-1 text-xl font-semibold tracking-tight">
            <Money value={borrowed.remaining} /> <span className="text-xs font-normal text-muted-foreground">left to repay</span>
          </span>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Borrowed</dt>
              <dd className="font-medium tabular">{formatTaka(borrowed.total)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Repaid</dt>
              <dd className="font-medium tabular text-good">{formatTaka(borrowed.repaid)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Remaining</dt>
              <dd className="font-medium tabular">{formatTaka(borrowed.remaining)}</dd>
            </div>
          </dl>
          <Meter value={borrowed.repaid} max={borrowed.total} className="mt-2 h-1.5" label={`${percent(borrowed.repaid, borrowed.total)}% repaid`} />
          {next.length > 0 && (
            <span className="mt-2 text-xs text-muted-foreground">
              Next — {next.join(" | ")}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

