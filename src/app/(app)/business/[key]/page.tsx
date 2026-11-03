import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Link2, Pencil, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardsSkeleton, EmptyState, PageHeader, Section, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { BusinessSettingsDialog, BusinessSetupForm, BusinessTxnDialog, DeleteBusinessTxnButton, PeriodFilterBar } from "@/components/business-forms";
import { requireUser } from "@/lib/auth/session";
import { getBusinessLedger, otherBusinesses, type BusinessTxnView } from "@/lib/services/business";
import { businessPreset } from "@/lib/business/registry";
import { BUSINESS_KIND_LABELS, directionOf } from "@/lib/business/model";
import { parsePeriod } from "@/lib/business/period";
import { formatDate } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { cn } from "@/lib/utils";

type SP = Record<string, string | string[] | undefined>;

export default function BusinessPage({ params, searchParams }: PageProps<"/business/[key]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <CardsSkeleton count={4} />
          <TableSkeleton rows={8} />
        </div>
      }
    >
      <BusinessView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BusinessView({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const { key } = await params;
  const preset = businessPreset(key);
  if (!preset || !preset.available) notFound();
  const user = await requireUser();
  const filter = parsePeriod(await searchParams);
  const [ledger, others] = await Promise.all([getBusinessLedger(user.id, key, filter), otherBusinesses(user.id, key)]);

  const back = (
    <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> All accounts
    </Link>
  );

  if (!ledger) {
    return (
      <>
        {back}
        <PageHeader
          title={`Set up ${preset.name}`}
          help="business"
          description="Confirm the business details and enter the opening balance. Nothing is recorded until you save."
        />
        <Section>
          <BusinessSetupForm businessKey={key} initial={{ name: preset.name, type: preset.type }} />
        </Section>
      </>
    );
  }

  const b = ledger.business;
  const o = ledger.overall;
  const p = ledger.period;
  const filtered = filter.mode !== "all";
  const addButton = (
    <BusinessTxnDialog
      businessKey={key}
      businessName={b.name}
      others={others}
      trigger={
        <Button>
          <Plus /> Add transaction
        </Button>
      }
    />
  );

  return (
    <>
      {back}
      <PageHeader
        title={b.name}
        help="business"
        description={`${b.type ? `${b.type} · ` : ""}records from ${formatDate(b.openingDate)}. Only ${b.name}'s own transactions count here.`}
        actions={
          <div className="flex gap-2">
            <BusinessSettingsDialog
              business={b}
              trigger={
                <Button variant="outline">
                  <Settings2 /> <span className="sr-only sm:not-sr-only">Details</span>
                </Button>
              }
            />
            {addButton}
          </div>
        }
      />

      <div className="space-y-5">
        <section aria-label={`${b.name} overview`} className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Stat
            className="col-span-2 lg:col-span-2"
            highlight
            label="Available balance"
            value={o.closingBalance}
            hint={`${formatTaka(o.openingBalance)} opening + ${formatTaka(o.moneyIn)} in − ${formatTaka(o.moneyOut)} out`}
          />
          <Stat label="Opening balance" value={o.openingBalance} hint={`on ${formatDate(b.openingDate)}`} />
          <Stat label="Total money in" value={o.moneyIn} />
          <Stat label="Total money out" value={o.moneyOut} />
          <Stat label="Investments received" value={o.investmentsReceived} hint="Capital — not revenue" />
          <Stat label="Business expenses" value={o.expenses} hint="Purchases, suppliers, hosting…" />
          <Stat label="Business income" value={o.income} hint="Revenue from sales / services" />
          {o.investedInOthers > 0 && <Stat label="Invested in other businesses" value={o.investedInOthers} />}
        </section>

        {ledger.recent.length > 0 && (
          <Section title="Recent transactions" description="The latest five, newest first.">
            <ul className="divide-y text-sm">
              {ledger.recent.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDate(t.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className={cn("tabular", directionOf(t.kind) === "in" && "text-good")}>
                    {directionOf(t.kind) === "in" ? "+" : "−"}
                    {formatTaka(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          title="Transaction history"
          description={
            filtered ? `${filter.label} — balances are the real balance after each transaction.` : "Newest first, with the balance after each transaction."
          }
          actions={
            <Suspense fallback={null}>
              <PeriodFilterBar />
            </Suspense>
          }
        >
          {filtered && (
            <dl className="mb-4 grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-4">
              <Fig label="Opening balance" value={p.openingBalance} />
              <Fig label="+ Money received" value={p.moneyIn} />
              <Fig label="− Money spent" value={p.moneyOut} />
              <Fig label="= Closing balance" value={p.closingBalance} strong />
            </dl>
          )}
          {ledger.rows.length === 0 && !filtered && b.openingBalance === 0 ? (
            <EmptyState
              title="No transactions yet"
              description="Add investments, income, purchases and expenses — the balance updates with each one."
              action={addButton}
            />
          ) : (
            <HistoryTable
              rows={ledger.rows}
              businessKey={key}
              businessName={b.name}
              others={others}
              opening={filtered ? null : { amount: b.openingBalance, date: b.openingDate }}
              emptyText={`No transactions in ${filter.label.toLowerCase()}.`}
            />
          )}
        </Section>
      </div>
    </>
  );
}

function Stat({ label, value, hint, highlight = false, className }: { label: string; value: number; hint?: string; highlight?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col rounded-xl border bg-card p-4", highlight && "border-primary/40 bg-primary/5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("mt-1 font-semibold tracking-tight", highlight ? "text-3xl" : "text-xl")}>
        <Money value={value} tone={highlight ? "auto" : "default"} />
      </span>
      {hint && <span className="mt-1 text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Fig({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular", strong ? "text-base font-semibold" : "font-medium")}>{formatTaka(value)}</dd>
    </div>
  );
}

function HistoryTable({
  rows,
  businessKey,
  businessName,
  others,
  opening,
  emptyText,
}: {
  rows: BusinessTxnView[];
  businessKey: string;
  businessName: string;
  others: { id: string; name: string }[];
  opening: { amount: number; date: string } | null;
  emptyText: string;
}) {
  if (rows.length === 0 && !opening) return <EmptyState title={emptyText} />;
  const actions = (t: BusinessTxnView) => (
    <div className="flex justify-end gap-0.5">
      <BusinessTxnDialog
        businessKey={businessKey}
        businessName={businessName}
        others={others}
        txn={t}
        trigger={
          <Button variant="ghost" size="icon-xs" aria-label={`Edit ${t.title}`}>
            <Pencil />
          </Button>
        }
      />
      <DeleteBusinessTxnButton businessKey={businessKey} txn={t} />
    </div>
  );
  const detail = (t: BusinessTxnView) => (
    <>
      <span className="block text-xs text-muted-foreground">
        {BUSINESS_KIND_LABELS[t.kind]}
        {t.other && (
          <>
            {" · "}
            <Link2 className="inline size-3" aria-hidden /> linked with {t.other.name}
          </>
        )}
        {t.party && ` · ${t.party}`}
      </span>
      {t.note && <span className="block text-xs text-muted-foreground">{t.note}</span>}
    </>
  );
  // Newest first; the balances were worked out oldest → newest, so each row still shows the
  // real balance right after it. The opening balance is the oldest line, at the bottom.
  const newestFirst = [...rows].reverse();
  return (
    <>
      {/* Phones: one card per transaction. */}
      <ul className="divide-y text-sm sm:hidden">
        {newestFirst.map((t) => {
          const isIn = directionOf(t.kind) === "in";
          return (
            <li key={t.id} className="flex items-start gap-2 py-2.5" data-row={t.title}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t.title}</span>
                <span className="block text-xs text-muted-foreground">{formatDate(t.date)}</span>
                {detail(t)}
              </span>
              <span className="shrink-0 text-right tabular">
                <span className={cn("block", isIn && "text-good")}>
                  {isIn ? "+" : "−"}
                  {formatTaka(t.amount)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Bal{" "}
                  <span data-balance>
                    <Money value={t.balance} tone="auto" />
                  </span>
                </span>
                {actions(t)}
              </span>
            </li>
          );
        })}
        {opening && (
          <li className="flex items-start justify-between gap-3 py-2.5" data-row="opening">
            <span className="min-w-0">
              <span className="font-medium">Opening balance</span>
              <span className="block text-xs text-muted-foreground">{formatDate(opening.date)} · not income</span>
            </span>
            <span className="text-right tabular">
              <span className="block font-medium" data-balance>
                {formatTaka(opening.amount)}
              </span>
            </span>
          </li>
        )}
      </ul>
      <div className="-mx-1 hidden overflow-x-auto px-1 sm:block">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">Transaction</th>
              <th className="pb-2 text-right font-medium">Amount</th>
              <th className="pb-2 text-right font-medium">Balance</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="tabular">
            {newestFirst.map((t) => {
              const isIn = directionOf(t.kind) === "in";
              return (
                <tr key={t.id} className="border-t align-top">
                  <td className="py-2 pr-2 whitespace-nowrap">{formatDate(t.date)}</td>
                  <td className="py-2 pr-2">
                    <span className="font-medium">{t.title}</span>
                    {detail(t)}
                  </td>
                  <td className={cn("py-2 text-right whitespace-nowrap", isIn ? "text-good" : "")}>
                    {isIn ? "+" : "−"}
                    {formatTaka(t.amount)}
                  </td>
                  <td className="py-2 text-right font-medium whitespace-nowrap" data-balance>
                    <Money value={t.balance} tone="auto" />
                  </td>
                  <td className="py-2 pl-1">{actions(t)}</td>
                </tr>
              );
            })}
            {opening && (
              <tr className="border-t bg-muted/30">
                <td className="py-2 pr-2 whitespace-nowrap">{formatDate(opening.date)}</td>
                <td className="py-2 pr-2">
                  <span className="font-medium">Opening balance</span>
                  <span className="block text-xs text-muted-foreground">Money available when the records start — not income</span>
                </td>
                <td className="py-2 text-right">{formatTaka(opening.amount)}</td>
                <td className="py-2 text-right font-medium" data-balance>
                  {formatTaka(opening.amount)}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
