import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Meter, PageHeader, StatCard, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { ButtonLink } from "@/components/button-link";
import { GoalDialog, SavingsMoveDialog } from "@/components/savings-forms";
import { requireUser } from "@/lib/auth/session";
import { listGoals } from "@/lib/services/savings";
import { getLookups } from "@/lib/services/lookups";
import { getBalanceSummary } from "@/lib/services/finance";
import { formatDate } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { GOAL_KIND_LABELS, PRIORITY_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Savings Goals" };

export default function SavingsPage({ searchParams }: PageProps<"/savings">) {
  return (
    <>
      <PageHeader
        title="Savings Goals"
        help="savings"
        description="Set money aside for emergencies and plans. Savings are separate from spending and never moved automatically."
        actions={
          <ButtonLink href="/investments" variant="outline">
            <TrendingUp /> Investments
          </ButtonLink>
        }
      />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <Savings searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Savings({ searchParams }: { searchParams: PageProps<"/savings">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [goals, lookups, balance] = await Promise.all([listGoals(user.id), getLookups(user.id), getBalanceSummary(user.id)]);
  const preset = sp.new === "medical" ? "medical" : undefined;
  const total = goals.reduce((s, g) => s + g.balance, 0);
  const monthDeposits = goals.reduce((s, g) => s + g.thisMonthDeposits, 0);
  const monthlyTarget = goals.filter((g) => g.status === "active").reduce((s, g) => s + g.monthlyTarget, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total in savings" value={<Money value={total} />} />
        <StatCard label="Spendable balance" value={<Money value={balance.spendable} />} hint="Available to save" />
        <StatCard label="Saved this month" value={<Money value={monthDeposits} />} hint={monthlyTarget ? `Target ${formatTaka(monthlyTarget)}` : undefined} />
        <StatCard label="Active goals" value={goals.filter((g) => g.status === "active").length} />
      </div>

      <div className="flex justify-end">
        <GoalDialog
          accounts={lookups.accounts}
          defaultOpen={!!preset}
          preset={preset}
          trigger={
            <Button>
              <Plus /> New goal
            </Button>
          }
        />
      </div>

      {goals.length === 0 ? (
        <EmptyState title="No savings goals yet" description="Start with a Medical Emergency Fund — a reserve for unexpected health costs." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {goals.map((g) => (
            <li key={g.id} className={`rounded-xl border bg-card p-4 ${g.status !== "active" ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/savings/${g.id}`} className="font-medium hover:underline">
                    {g.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {GOAL_KIND_LABELS[g.kind]} · {PRIORITY_LABELS[g.priority]} priority
                    {g.status !== "active" && ` · ${g.status}`}
                  </p>
                </div>
                <p className="text-sm font-semibold">{g.progressPct}%</p>
              </div>
              <Meter value={g.balance} max={g.targetAmount} className="mt-3" label={`${g.name} progress`} />
              <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground tabular">{formatTaka(g.balance)}</span> of {formatTaka(g.targetAmount)}
                </span>
                <span>{formatTaka(g.remainingTarget)} to go{g.targetDate && ` · by ${formatDate(g.targetDate)}`}</span>
              </div>
              {g.monthlyTarget > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This month: {formatTaka(g.thisMonthDeposits)} of {formatTaka(g.monthlyTarget)}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <SavingsMoveDialog goal={g} direction="deposit" accounts={lookups.accounts} spendable={balance.spendable} trigger={<Button size="sm">Add money</Button>} />
                <SavingsMoveDialog
                  goal={g}
                  direction="withdraw"
                  accounts={lookups.accounts}
                  spendable={balance.spendable}
                  trigger={
                    <Button size="sm" variant="outline" disabled={g.balance <= 0}>
                      Withdraw
                    </Button>
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
