import { Wallet } from "lucide-react";
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, Meter, PageHeader, Section, StatCard, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { ButtonLink } from "@/components/button-link";
import { TransactionForm } from "@/components/transaction-form";
import { requireUser } from "@/lib/auth/session";
import { getFundingSources, type FundingSourceRecord } from "@/lib/services/salary";
import { getFormContext } from "@/lib/services/forms";
import { formatDate } from "@/lib/dates";
import { formatTaka, percent } from "@/lib/money";
import { INCOME_KIND_LABELS, NON_INCOME_SOURCE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Income & Salary" };

export default function IncomePage() {
  return (
    <>
      <PageHeader
        title="Income & Salary"
        help="income"
        actions={<ButtonLink href="/income/history" variant="outline">Salary history</ButtonLink>}
        description="Each salary is tracked on its own. Expenses draw from the oldest salary with money left, and leftovers carry forward automatically."
      />
      <Suspense fallback={<TableSkeleton rows={10} />}>
        <IncomeView />
      </Suspense>
    </>
  );
}

const STATUS = {
  active: { label: "Unused", className: "text-good" },
  partial: { label: "Partially used", className: "text-warning" },
  exhausted: { label: "Exhausted", className: "text-muted-foreground" },
} as const;

async function IncomeView() {
  const user = await requireUser();
  const [sources, ctx] = await Promise.all([getFundingSources(user.id), getFormContext(user.id)]);
  const records = [...sources].reverse();
  const salaries = sources.filter((s) => s.kind === "salary");
  const totalRemaining = sources.reduce((s, r) => s + r.remaining, 0);
  const latest = salaries.at(-1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Latest salary" value={latest ? <Money value={latest.amount} /> : "—"} hint={latest ? `Received ${formatDate(latest.date)}` : "None yet"} />
        <StatCard label="Available across all salaries" value={<Money value={totalRemaining} />} hint="Unspent money, oldest used first" />
        <StatCard label="Salaries recorded" value={salaries.length} />
        <StatCard label="Total salary received" value={<Money value={salaries.reduce((s, r) => s + r.amount, 0)} />} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Section title="Add salary or income" help="income" description="Use a past received date to record historical salaries — balances are recalculated automatically.">
          <TransactionForm mode="income" lookups={ctx.lookups} defaults={{ ...ctx.defaults, incomeKind: "salary" }} />
        </Section>

        <Section title="Salary records" help="salaryRecords" description="Used and remaining amounts come from the FIFO funding ledger.">
          {records.length === 0 ? (
            <EmptyState icon={Wallet} title="No income recorded yet" description="Add your first salary to start tracking." />
          ) : (
            <ul className="divide-y">
              {records.map((r) => (
                <SourceRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function SourceRow({ r }: { r: FundingSourceRecord }) {
  const kind = r.kind in NON_INCOME_SOURCE_LABELS ? NON_INCOME_SOURCE_LABELS[r.kind as keyof typeof NON_INCOME_SOURCE_LABELS] : INCOME_KIND_LABELS[r.kind as keyof typeof INCOME_KIND_LABELS];
  return (
    <li className="py-3">
      <Link href={`/income/${r.id}`} className="-mx-2 block rounded-lg px-2 py-1 hover:bg-muted/50">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{r.label}</p>
            <p className="text-xs text-muted-foreground">
              {kind} · received {formatDate(r.date)}
              {r.exhaustedOn && ` · exhausted ${formatDate(r.exhaustedOn)}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">
              <Money value={r.remaining} /> <span className="text-xs font-normal text-muted-foreground">left of {formatTaka(r.amount)}</span>
            </p>
            <p className={cn("text-xs font-medium", STATUS[r.status].className)}>{STATUS[r.status].label}</p>
          </div>
        </div>
        <Meter value={r.used} max={r.amount} className="mt-2 h-1.5" label={`${percent(r.used, r.amount)}% used`} />
        {r.carriedForward !== null && (
          <p className="mt-1.5 text-xs text-muted-foreground">Carried forward when the next salary arrived: {formatTaka(r.carriedForward)}</p>
        )}
      </Link>
    </li>
  );
}
