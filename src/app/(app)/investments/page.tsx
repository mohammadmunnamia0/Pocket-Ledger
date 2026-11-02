import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardsSkeleton, EmptyState, PageHeader, Section } from "@/components/common";
import { ConfirmButton } from "@/components/confirm-button";
import { InvestmentDialog, ReturnDialog, ValueDialog } from "@/components/investment-forms";
import type { AccountChoice } from "@/components/loan-forms";
import { deleteInvestmentAction, deleteInvestmentEntryAction } from "@/app/actions/ledger";
import { requireUser } from "@/lib/auth/session";
import { getLookups } from "@/lib/services/lookups";
import { listInvestments, summarizeInvestments, type InvestmentView } from "@/lib/services/investments";
import { INVESTMENT_KIND_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Investments" };

export default function InvestmentsPage() {
  return (
    <>
      <PageHeader
        title="Investments"
        help="investments"
        description="Money you invested, what came back, and profit or loss. Investing is not an expense; returned capital is not income."
      />
      <Suspense fallback={<CardsSkeleton count={4} />}>
        <Investments />
      </Suspense>
    </>
  );
}

async function Investments() {
  const user = await requireUser();
  const [list, lookups] = await Promise.all([listInvestments(user.id), getLookups(user.id)]);
  const accounts: AccountChoice[] = lookups.accounts;
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const s = summarizeInvestments(list);
  return (
    <div className="space-y-5">
      <Section
        title="Your investments"
        description={
          <>
            Savings goals are in <Link href="/savings" className="underline underline-offset-2">Savings Goals</Link>; investments recorded earlier as expenses in an
            “Investment” category still count in the dashboard&apos;s “Invested” figure.
          </>
        }
        actions={
          <InvestmentDialog
            accounts={accounts}
            trigger={
              <Button size="sm">
                <Plus /> Add investment
              </Button>
            }
          />
        }
      >
        {list.length === 0 ? (
          <EmptyState title="No investments yet" description="Add money you put into a business, shares, a fixed deposit, land or anything else." />
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total invested" value={s.invested} />
              <Stat label="Still invested" value={s.stillInvested} strong />
              <Stat label="Capital returned" value={s.capitalReturned} />
              <Stat label="Profit received" value={s.profitReceived} tone={s.profitReceived > 0 ? "good" : undefined} />
              <Stat label="Current value" value={s.currentValue} />
              <Stat label="Profit / loss" value={s.profitOrLoss} signed />
            </dl>
            <ul className="grid gap-3 lg:grid-cols-2">
              {list.map((v) => (
                <InvestmentCard key={v.id} v={v} accounts={accounts} accountName={accountName} />
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value, tone, strong = false, signed = false }: { label: string; value: number | null; tone?: "good"; strong?: boolean; signed?: boolean }) {
  const color = signed && value !== null ? (value > 0 ? "text-good" : value < 0 ? "text-critical" : undefined) : tone === "good" ? "text-good" : undefined;
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular font-semibold", strong ? "text-xl" : "text-base", color)}>
        {value === null ? <span className="text-sm font-normal text-muted-foreground">Unknown</span> : `${signed && value > 0 ? "+" : ""}${formatTaka(value)}`}
      </dd>
    </div>
  );
}

function InvestmentCard({ v, accounts, accountName }: { v: InvestmentView; accounts: AccountChoice[]; accountName: Map<string, string> }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
            {v.name}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{INVESTMENT_KIND_LABELS[v.kind]}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Invested {formatDate(v.date)}
            {v.accountId && ` · from ${accountName.get(v.accountId) ?? "account"}`}
          </p>
          {v.note && <p className="mt-1 text-sm">{v.note}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Profit / loss</p>
          <p className={cn("text-lg font-semibold tabular", v.profitOrLoss !== null && (v.profitOrLoss > 0 ? "text-good" : v.profitOrLoss < 0 ? "text-critical" : ""))}>
            {v.profitOrLoss === null ? <span className="text-sm font-normal text-muted-foreground">Unknown</span> : `${v.profitOrLoss > 0 ? "+" : ""}${formatTaka(v.profitOrLoss)}`}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Invested</dt>
          <dd className="font-medium tabular">{formatTaka(v.invested)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Capital back</dt>
          <dd className="font-medium tabular">{formatTaka(v.capitalReturned)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Profit received</dt>
          <dd className="font-medium tabular">{formatTaka(v.profitReceived)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Value now</dt>
          <dd className="font-medium tabular">{v.currentValue === null ? "—" : formatTaka(v.currentValue)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <ReturnDialog
          investment={v}
          accounts={accounts}
          trigger={
            <Button size="sm" variant="outline">
              <Plus /> Record return
            </Button>
          }
        />
        <ValueDialog
          investment={v}
          trigger={
            <Button size="sm" variant="ghost">
              Current value
            </Button>
          }
        />
        <InvestmentDialog
          investment={v}
          accounts={accounts}
          trigger={
            <Button size="sm" variant="ghost">
              <Pencil /> Edit
            </Button>
          }
        />
        <ConfirmButton
          title={`Delete ${v.name}?`}
          description="The investment and all its returns are removed and every balance is recalculated."
          action={deleteInvestmentAction.bind(null, v.id)}
          variant="ghost"
          size="sm"
        >
          <Trash2 /> Delete
        </ConfirmButton>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">History ({v.entries.length})</summary>
        <ul className="mt-2 divide-y">
          {v.entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1.5">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDate(e.date)}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.title}
                {e.role === "profit" && <span className="text-xs text-good"> · income</span>}
                {e.role === "capital" && <span className="text-xs text-muted-foreground"> · not income</span>}
              </span>
              <span className="tabular">{formatTaka(e.amount)}</span>
              {e.role !== "invested" && (
                <ConfirmButton
                  title="Remove this entry?"
                  description="Balances are recalculated."
                  action={deleteInvestmentEntryAction.bind(null, v.id, e.id)}
                  variant="ghost"
                  size="icon-xs"
                >
                  <Trash2 />
                  <span className="sr-only">Remove {e.title}</span>
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
