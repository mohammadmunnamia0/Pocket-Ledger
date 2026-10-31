import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Meter, Section, StatCard, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { TxnList } from "@/components/txn-list";
import { ConfirmButton } from "@/components/confirm-button";
import { GoalDialog, SavingsMoveDialog } from "@/components/savings-forms";
import { requireUser } from "@/lib/auth/session";
import { listGoals } from "@/lib/services/savings";
import { getLookups } from "@/lib/services/lookups";
import { getBalanceSummary } from "@/lib/services/finance";
import { listTransactions } from "@/lib/services/transactions";
import { isObjectId } from "@/lib/db/models";
import { formatDate } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { GOAL_KIND_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { deleteGoalAction } from "@/app/actions/ledger";

export const metadata: Metadata = { title: "Savings goal" };

export default function GoalPage({ params }: PageProps<"/savings/[id]">) {
  return (
    <>
      <Link href="/savings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Savings Goals
      </Link>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <Goal params={params} />
      </Suspense>
    </>
  );
}

async function Goal({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const [goals, lookups, balance, history] = await Promise.all([
    listGoals(user.id),
    getLookups(user.id),
    getBalanceSummary(user.id),
    listTransactions(user.id, { goalId: id, pageSize: 200 }),
  ]);
  const g = goals.find((x) => x.id === id);
  if (!g) notFound();
  const account = g.accountId ? lookups.accounts.find((a) => a.id === g.accountId)?.name : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{g.name}</h1>
          <p className="text-sm text-muted-foreground">
            {GOAL_KIND_LABELS[g.kind]} · {PRIORITY_LABELS[g.priority]} priority · {g.status}
            {account && ` · held in ${account}`}
          </p>
          {g.description && <p className="mt-1 max-w-xl text-sm">{g.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
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
          <GoalDialog
            goal={g}
            accounts={lookups.accounts}
            trigger={
              <Button size="sm" variant="outline">
                <Pencil /> Edit
              </Button>
            }
          />
          <ConfirmButton title={`Delete ${g.name}?`} description="Only goals without deposits or withdrawals can be deleted." action={deleteGoalAction.bind(null, g.id)}>
            <Trash2 /> Delete
          </ConfirmButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Current savings" value={<Money value={g.balance} />} />
        <StatCard label="Target" value={<Money value={g.targetAmount} />} hint={g.targetDate ? `By ${formatDate(g.targetDate)}` : undefined} />
        <StatCard label="Remaining target" value={<Money value={g.remainingTarget} />} />
        <StatCard label="Total deposited" value={<Money value={g.deposited} />} hint={`Withdrawn ${formatTaka(g.withdrawn)}`} />
      </div>
      <Meter value={g.balance} max={g.targetAmount} label="Goal progress" />

      <Section title="Deposits & withdrawals">
        {history.rows.length ? <TxnList items={history.rows} /> : <EmptyState title="No activity yet" description="Use “Add money” to make your first contribution." />}
      </Section>
    </div>
  );
}
