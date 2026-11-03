import { Suspense } from "react";
import type { Metadata } from "next";
import { HandCoins, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardsSkeleton, EmptyState, Meter, PageHeader, Section } from "@/components/common";
import { Money } from "@/components/money";
import { ConfirmButton } from "@/components/confirm-button";
import { LoanDialog, RepaymentDialog, type AccountChoice } from "@/components/loan-forms";
import { deleteLoanAction, deleteLoanEntryAction } from "@/app/actions/ledger";
import { requireUser } from "@/lib/auth/session";
import { getLookups } from "@/lib/services/lookups";
import { listLoans, summarizeLoans, type LoanStatus, type LoanView } from "@/lib/services/loans";
import { formatDate, todayISO } from "@/lib/dates";
import { formatTaka, percent } from "@/lib/money";
import type { LoanDirection } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Lending & Borrowing" };

export default function LoansPage() {
  return (
    <>
      <PageHeader
        title="Lending & Borrowing"
        help="loans"
        description="Money you lent to people and money you borrowed — with repayments and what is still outstanding. Neither is income or expense."
      />
      <Suspense fallback={<CardsSkeleton count={4} />}>
        <Loans />
      </Suspense>
    </>
  );
}

async function Loans() {
  const user = await requireUser();
  const today = todayISO();
  const [loans, lookups] = await Promise.all([listLoans(user.id, today), getLookups(user.id)]);
  const accounts: AccountChoice[] = lookups.accounts;
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <div className="space-y-5">
      {(["lent", "borrowed"] as const).map((direction) => (
        <DirectionSection key={direction} direction={direction} loans={loans.filter((l) => l.direction === direction)} accounts={accounts} accountName={accountName} />
      ))}
    </div>
  );
}

const TEXT = {
  lent: {
    title: "Money I lent",
    add: "Lend money",
    total: "Total lent",
    repaid: "Repaid to me",
    outstanding: "Owed to me",
    people: "Who owes you",
    empty: "No money lent yet",
    interest: "Interest received",
  },
  borrowed: {
    title: "Money I borrowed",
    add: "Borrow money",
    total: "Total borrowed",
    repaid: "Repaid by me",
    outstanding: "I still owe",
    people: "Who you owe",
    empty: "No money borrowed yet",
    interest: "Interest paid",
  },
} as const;

function DirectionSection({
  direction,
  loans,
  accounts,
  accountName,
}: {
  direction: LoanDirection;
  loans: LoanView[];
  accounts: AccountChoice[];
  accountName: Map<string, string>;
}) {
  const t = TEXT[direction];
  const s = summarizeLoans(loans, direction);
  return (
    <Section
      title={t.title}
      actions={
        <LoanDialog
          direction={direction}
          accounts={accounts}
          trigger={
            <Button size="sm">
              <Plus /> {t.add}
            </Button>
          }
        />
      }
    >
      {loans.length === 0 ? (
        <EmptyState title={t.empty} description={direction === "lent" ? "Record money you give someone to be paid back." : "Record money you receive from someone and must pay back."} />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t.total} value={s.total} />
            <Stat label={t.repaid} value={s.repaid} tone="good" />
            <Stat label={t.outstanding} value={s.outstanding} strong />
            <Stat label={t.interest} value={s.interest} />
          </dl>
          {s.byPerson.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{t.people}</h3>
              <ul className="flex flex-wrap gap-2">
                {s.byPerson.map((p) => (
                  <li key={p.person} className="rounded-lg border px-3 py-1.5 text-sm">
                    <span className="font-medium">{p.person}</span> · <span className="tabular">{formatTaka(p.outstanding)}</span>
                    {p.nextDue && <span className="text-xs text-muted-foreground"> · due {formatDate(p.nextDue)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="grid gap-3 lg:grid-cols-2">
            {loans.map((l) => (
              <LoanCard key={l.id} loan={l} accounts={accounts} accountName={accountName} />
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value, tone, strong = false }: { label: string; value: number; tone?: "good"; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular font-semibold", strong ? "text-xl" : "text-base", tone === "good" && "text-good")}>{formatTaka(value)}</dd>
    </div>
  );
}

const STATUS: Record<LoanStatus, { label: string; className: string }> = {
  outstanding: { label: "Outstanding", className: "bg-warning-mark/15 text-foreground" },
  partial: { label: "Partially repaid", className: "bg-primary/10 text-primary" },
  repaid: { label: "Fully repaid", className: "bg-good-mark/15 text-good" },
};

function LoanCard({ loan: l, accounts, accountName }: { loan: LoanView; accounts: AccountChoice[]; accountName: Map<string, string> }) {
  const lent = l.direction === "lent";
  const st = STATUS[l.status];
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <HandCoins className="size-4 text-muted-foreground" aria-hidden />
            {l.person}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.className)}>{st.label}</span>
            {l.overdue && <span className="rounded-full bg-critical/10 px-2 py-0.5 text-[11px] font-medium text-critical">Overdue</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {lent ? "Lent" : "Borrowed"} {formatDate(l.date)}
            {l.accountId && ` · ${lent ? "from" : "into"} ${accountName.get(l.accountId) ?? "account"}`}
            {l.dueDate && ` · expected back ${formatDate(l.dueDate)}`}
          </p>
          {l.note && <p className="mt-1 text-sm">{l.note}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-lg font-semibold tabular">
            <Money value={l.outstanding} />
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="font-medium tabular">{formatTaka(l.principal)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Repaid</dt>
          <dd className="font-medium tabular text-good">{formatTaka(l.repaid)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{lent ? "Interest received" : "Interest paid"}</dt>
          <dd className="font-medium tabular">{formatTaka(l.interest)}</dd>
        </div>
      </dl>
      <Meter value={l.repaid} max={l.principal} className="mt-2 h-1.5" label={`${percent(l.repaid, l.principal)}% repaid`} />

      <div className="mt-3 flex flex-wrap gap-2">
        {l.outstanding > 0 && (
          <RepaymentDialog
            loan={l}
            accounts={accounts}
            trigger={
              <Button size="sm" variant="outline">
                <Plus /> Record repayment
              </Button>
            }
          />
        )}
        <LoanDialog
          direction={l.direction}
          loan={l}
          accounts={accounts}
          trigger={
            <Button size="sm" variant="ghost">
              <Pencil /> Edit
            </Button>
          }
        />
        <ConfirmButton
          title={`Delete the loan ${lent ? "to" : "from"} ${l.person}?`}
          description="The loan and all its repayments are removed and every balance is recalculated. Refused if the money was already spent."
          action={deleteLoanAction.bind(null, l.id)}
          variant="ghost"
          size="sm"
        >
          <Trash2 /> Delete
        </ConfirmButton>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">History ({l.entries.length})</summary>
        <ul className="mt-2 divide-y">
          {[...l.entries].reverse().map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1.5">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDate(e.date)}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.title}
                {e.note && <span className="text-xs text-muted-foreground"> · {e.note}</span>}
              </span>
              <span className="tabular">{formatTaka(e.amount)}</span>
              {e.role !== "principal" && (
                <ConfirmButton
                  title="Remove this entry?"
                  description="Balances and the outstanding amount are recalculated."
                  action={deleteLoanEntryAction.bind(null, l.id, e.id)}
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
