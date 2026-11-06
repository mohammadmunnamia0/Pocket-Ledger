import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Wallet } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { requireUser } from "@/lib/auth/session";
import { getSalaryHistory } from "@/lib/services/salary";
import { formatDate } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Salary history" };

export default function SalaryHistoryPage() {
  return (
    <>
      <Link href="/income" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Income & Salary
      </Link>
      <PageHeader
        title="Salary history"
        help="salaryHistory"
        description="Each salary period runs from the day a salary arrives until the next one. See what was carried in, received, spent and carried on."
      />
      <Suspense fallback={<TableSkeleton rows={10} />}>
        <History />
      </Suspense>
    </>
  );
}

async function History() {
  const user = await requireUser();
  const periods = await getSalaryHistory(user.id);
  if (periods.length === 0) {
    return <EmptyState icon={Wallet} title="No salary recorded yet" action={<ButtonLink href="/income">Add salary</ButtonLink>} />;
  }

  return (
    <ol className="space-y-4">
      {periods.map((p, i) => {
        const current = p.end === null;
        const spent = p.payments.reduce((s, x) => s + x.amount, 0);
        return (
          <li key={p.salaryId} id={`period-${p.salaryId}`} className={cn("scroll-mt-20 rounded-xl border bg-card", current && "border-primary/40")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
              <div>
                <h2 className="font-semibold">
                  {p.label}
                  {current && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Current</span>}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Received {formatDate(p.start)} · period {formatDate(p.start)} – {current ? "today" : formatDate(p.end)}
                </p>
              </div>
              <Link href={`/income/${p.salaryId}`} className="text-xs text-primary hover:underline">
                Which expenses this salary paid for →
              </Link>
            </div>

            {/* The period as one sum */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 text-sm sm:grid-cols-5">
              <Fig label="Carried in" value={p.carriedIn} hint={p.carriedFrom.length ? `from ${p.carriedFrom.map((c) => `${c.label} (${formatTaka(c.amount)})`).join(", ")}` : "nothing left from before"} />
              <Fig label="+ Salary received" value={p.startingAmount} hint={[p.otherIncome ? `+ ${formatTaka(p.otherIncome)} other income` : "", p.otherInflows ? `+ ${formatTaka(p.otherInflows)} investment capital back (not income)` : ""].filter(Boolean).join(" · ") || undefined} />
              <Fig label="= Total available" value={p.totalAvailable} />
              <Fig label="− Spent in period" value={p.totalSpent} hint={`${p.expenseCount} payment${p.expenseCount === 1 ? "" : "s"}`} />
              <Fig
                label={current ? "= Left now" : "= Carried to next salary"}
                value={p.remainingAtEnd}
                strong
                hint={!current && i > 0 ? `→ ${periods[i - 1].label}` : undefined}
              />
            </dl>

            <details className="border-t px-4 py-2 text-sm">
              <summary className="cursor-pointer py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                Show the {p.payments.length} payment{p.payments.length === 1 ? "" : "s"} in this period
              </summary>
              <div className="relative overflow-x-auto">
                <table className="mt-2 w-full">
                  <tbody className="tabular">
                    {p.payments.map((x) => (
                      <tr key={x.id} className="border-t">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">{formatDate(x.date)}</td>
                        <td className="py-1.5 pr-3">
                          <Link href={`/transactions/${x.id}`} className="hover:underline">
                            {x.title}
                          </Link>
                          {x.categoryLabel && <span className="block text-xs text-muted-foreground">{x.categoryLabel}</span>}
                        </td>
                        <td className="py-1.5 text-right">{formatTaka(x.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold">
                      <td className="py-1.5" colSpan={2}>
                        Total spent
                      </td>
                      <td className="py-1.5 text-right">{formatTaka(spent)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

function Fig({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className={cn(strong && "col-span-2 sm:col-span-1")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5", strong ? "text-lg font-semibold" : "font-medium")}>
        <Money value={value} tone="auto" />
      </dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
