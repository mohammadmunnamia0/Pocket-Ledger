import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState, PageHeader, Section, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { TxnList } from "@/components/txn-list";
import { ReportFilters } from "@/components/report-filters";
import { HelpButton } from "@/components/help";
import { CategoryBarChart, DailySpendChart } from "@/components/charts";
import { requireUser } from "@/lib/auth/session";
import { getLookups } from "@/lib/services/lookups";
import { getMonthSummaries, getPeriodReport } from "@/lib/services/finance";
import { getSalaryCycles } from "@/lib/services/salary";
import { parseReportParams } from "@/lib/report-params";
import { addDays, addMonths, formatDate, formatMonth, formatMonthLong } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Monthly Reports" };

type SP = Record<string, string | string[] | undefined>;

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <>
      <PageHeader title="Monthly Reports" help="reports" description="Generated from your transaction records — calendar months and salary cycles are reported independently." />
      <Suspense fallback={<TableSkeleton rows={12} />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Reports({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.view === "cycles" ? "cycles" : "calendar";
  const tab = (v: string, label: string) => (
    <Link
      href={v === "calendar" ? "/reports" : "/reports?view=cycles"}
      aria-current={view === v ? "page" : undefined}
      className={cn("rounded-md px-3 py-1.5 text-sm text-muted-foreground", view === v && "bg-card font-medium text-foreground shadow-sm")}
    >
      {label}
    </Link>
  );
  return (
    <>
      <nav className="mb-5 inline-flex rounded-lg bg-muted p-1" aria-label="Report type">
        {tab("calendar", "Calendar month")}
        {tab("cycles", "Salary cycles")}
      </nav>
      <HelpButton topic={view === "cycles" ? "salaryCycles" : "balanceSummary"} className="ml-1 align-middle" label="সাহায্য: Calendar month ও Salary cycles" />
      {view === "cycles" ? <CycleReport userId={user.id} /> : <CalendarReport userId={user.id} sp={sp} />}
    </>
  );
}

async function CalendarReport({ userId, sp }: { userId: string; sp: SP }) {
  const { month, from, to, custom, filters, thisMonth } = parseReportParams(sp);
  const lookups = await getLookups(userId);
  const [r, summaries] = await Promise.all([
    getPeriodReport(userId, from, to, filters, lookups),
    getMonthSummaries(userId, addMonths(thisMonth, -11), thisMonth),
  ]);
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  const title = custom ? `${formatDate(from)} – ${formatDate(to)}` : formatMonthLong(month);
  const daily: { date: string; total: number }[] = [];
  const dailyMap = new Map(r.daily.map((d) => [d.date, d.total]));
  for (let d = from; d <= to && daily.length < 62; d = addDays(d, 1)) daily.push({ date: d, total: dailyMap.get(d) ?? 0 });

  const lines: [string, number, string?][] = [
    ["Opening balance (carried forward)", r.openingBalance],
    ["+ Salary", r.salary],
    ["+ Additional income", r.additionalIncome],
    ...(r.broughtIn ? ([["+ Opening balance entries", r.broughtIn]] as [string, number][]) : []),
    ["= Total available balance", r.totalAvailable, "font-medium border-t"],
    ["− Expenses", r.expenses],
    ["− Savings / investments (net)", r.savingsAndTransfers],
    ["= Closing balance", r.closingBalance, "font-semibold border-t"],
  ];

  return (
    <div className="space-y-5">
      <ReportFilters currentMonth={thisMonth} categories={lookups.categories} persons={lookups.persons} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <ButtonLink href={`/api/export/report${qs ? `?${qs}` : ""}`} variant="outline" prefetch={false}>
          <Download /> Export CSV
        </ButtonLink>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Section title="Balance summary" help="balanceSummary" description="Closing = opening + income − outflows. Balances ignore the filters.">
          <table className="w-full text-sm">
            <tbody className="tabular">
              {lines.map(([label, value, cls]) => (
                <tr key={label} className={cn(cls)}>
                  <td className="py-1.5 pr-3">{label}</td>
                  <td className="py-1.5 text-right">
                    <Money value={value} tone="auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(r.investments > 0 || r.savingsDeposits > 0 || r.savingsWithdrawals > 0 || r.pendingTotal > 0) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Investments {formatTaka(r.investments)} · deposits {formatTaka(r.savingsDeposits)} · withdrawals {formatTaka(r.savingsWithdrawals)}
              {r.pendingTotal > 0 && ` · ${formatTaka(r.pendingTotal)} pending (not deducted)`}
            </p>
          )}
        </Section>

        <Section title="Category-wise spending" description={filters.basis === "attribution" ? "Grouped by the month each expense belongs to" : "Grouped by payment date"}>
          {r.categories.length === 0 ? (
            <EmptyState title="No spending in this period" />
          ) : (
            <>
              <CategoryBarChart data={r.categories} />
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 text-right font-medium">Total spent</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {r.categories.map((c) => (
                    <tr key={c.id} className="border-t align-top">
                      <td className="py-2">
                        <details>
                          <summary className="cursor-pointer font-medium">{c.name}</summary>
                          <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted-foreground">
                            {c.children.map((ch) => (
                              <li key={ch.id} className="flex justify-between gap-4">
                                <span>{ch.name}</span>
                                <span>{formatTaka(ch.total)}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td className="py-2 text-right font-medium">{formatTaka(c.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold">
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right">{formatTaka(r.categories.reduce((s, c) => s + c.total, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </Section>
      </div>

      {daily.some((d) => d.total > 0) && (
        <Section title="Daily spending">
          <DailySpendChart data={daily} />
        </Section>
      )}

      <Section title="Last 12 months" description="Each month's closing balance carries into the next month's opening.">
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Month</th>
                <th className="pb-2 text-right font-medium">Opening</th>
                <th className="pb-2 text-right font-medium">Income</th>
                <th className="pb-2 text-right font-medium">Outflows</th>
                <th className="pb-2 text-right font-medium">Closing</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...summaries].reverse().map((s) => (
                <tr key={s.month} className="border-t">
                  <td className="py-2">
                    <Link href={`/reports?month=${s.month}`} className="hover:underline">
                      {formatMonth(s.month)}
                    </Link>
                  </td>
                  <td className="py-2 text-right text-muted-foreground">{formatTaka(s.opening)}</td>
                  <td className="py-2 text-right">{formatTaka(s.income)}</td>
                  <td className="py-2 text-right">{formatTaka(s.outflows)}</td>
                  <td className="py-2 text-right font-medium">{formatTaka(s.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Transactions in this period" description={`${r.transactions.length} records${filters.categoryId || filters.personId || filters.status ? " (filtered)" : ""}`}>
        {r.transactions.length ? <TxnList items={[...r.transactions].reverse()} /> : <EmptyState title="No transactions" />}
      </Section>
    </div>
  );
}

async function CycleReport({ userId }: { userId: string }) {
  const cycles = [...(await getSalaryCycles(userId))].reverse();
  if (cycles.length === 0) {
    return <EmptyState title="No salary cycles yet" description="A cycle starts on the day a salary is received and runs until the next salary." />;
  }
  return (
    <div className="space-y-3">
      {cycles.map((c) => (
        <Section
          key={c.salaryId}
          title={
            <Link href={`/income/${c.salaryId}`} className="hover:underline">
              {c.label}
            </Link>
          }
          description={`${formatDate(c.start)} – ${c.end ? formatDate(c.end) : "today (current cycle)"}${c.nextSalaryDate ? ` · next salary ${formatDate(c.nextSalaryDate)}` : ""}`}
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Cell label="Salary amount" value={c.startingAmount} />
            <Cell label="Carried forward in" value={c.carriedIn} />
            <Cell label="Other income in cycle" value={c.otherIncome} />
            <Cell label="Total available" value={c.totalAvailable} strong />
            <Cell label="Spent in cycle" value={c.totalSpent} hint={`${c.expenseCount} payments`} />
            <Cell label="Funded by this salary" value={c.fundedByThisSalary} />
            <Cell label="Funded by previous salaries" value={c.fundedByPrevious} />
            <Cell label="Funded by other income" value={c.fundedByOther} />
            <Cell label="This salary remaining" value={c.thisSalaryRemaining} strong />
            <Cell label="Previous salaries remaining" value={c.previousRemaining} />
          </dl>
        </Section>
      ))}
    </div>
  );
}

function Cell({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5", strong && "font-semibold")}>
        <Money value={value} />
      </dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
