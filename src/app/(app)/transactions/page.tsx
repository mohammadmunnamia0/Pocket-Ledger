import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeftRight, Download, Pencil } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState, PageHeader, StatusBadge, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { TransactionFilters } from "@/components/transaction-filters";
import { TxnAmount, TxnIcon, placeLabel } from "@/components/txn-list";
import { DeleteTxnButton, MarkPaidButton } from "@/components/txn-actions";
import { requireUser } from "@/lib/auth/session";
import { getLookups } from "@/lib/services/lookups";
import { listTransactions } from "@/lib/services/transactions";
import { parseTxnFilters } from "@/lib/filters";
import { addDays, formatDate } from "@/lib/dates";
import { getBalanceSummary } from "@/lib/services/finance";
import { parsePeriod } from "@/lib/business/period";
import { PeriodFilterBar } from "@/components/business-forms";
import { formatTaka } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, TXN_TYPE_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Transactions" };

type SP = Record<string, string | string[] | undefined>;

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <>
      <PageHeader
        title="Transactions"
        help="transactions"
        description="Every income, expense, transfer and savings move — with the running balance after each."
        actions={<Suspense fallback={null}><ExportLink searchParams={searchParams} /></Suspense>}
      />
      <Suspense fallback={<TableSkeleton rows={10} />}>
        <TransactionsView searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ExportLink({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "page")).toString();
  return (
    <ButtonLink href={`/api/export/transactions${qs ? `?${qs}` : ""}`} variant="outline" prefetch={false}>
      <Download /> Export CSV
    </ButtonLink>
  );
}

async function TransactionsView({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseTxnFilters(sp);
  const lookups = await getLookups(user.id);
  const list = await listTransactions(user.id, filters, lookups);
  // A running balance is only meaningful when every transaction is listed. Filtering by type,
  // status, category, person or search hides some (e.g. the salary), so the balance would jump
  // for no visible reason — hide it then. A date range alone keeps every row, so it stays.
  const showBalance = !(filters.q || filters.type || filters.flow || filters.status || filters.categoryId || filters.personId);
  const filtered = showBalance ? !!(filters.from || filters.to) : true;

  // Date-only filter → a balance statement: the real balance before the period, what came in
  // and went out (paid, not transfers), and the closing balance = opening + in − out.
  let statement: { label: string; opening: number; moneyIn: number; moneyOut: number; closing: number } | null = null;
  if (showBalance && (filters.from || filters.to)) {
    const opening = filters.from ? (await getBalanceSummary(user.id, addDays(filters.from, -1))).spendable : 0;
    const p = parsePeriod(sp);
    statement = {
      label: p.mode !== "all" && p.mode !== "range" ? p.label : `${filters.from ? formatDate(filters.from) : "Start"} – ${filters.to ? formatDate(filters.to) : "today"}`,
      opening,
      moneyIn: list.totals.moneyIn,
      moneyOut: list.totals.moneyOut,
      closing: opening + list.totals.moneyIn - list.totals.moneyOut,
    };
  }

  const pageHref = (p: number) => {
    const next = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
    next.set("page", String(p));
    return `/transactions?${next.toString()}`;
  };

  return (
    <>
      <TransactionFilters categories={lookups.categories} persons={lookups.persons} />
      <div className="mb-3">
        <PeriodFilterBar />
      </div>
      {statement && (
        <section aria-label="Period balance" className="mb-3 rounded-lg border bg-card px-3 py-2.5">
          <p className="mb-1.5 text-xs text-muted-foreground">
            {statement.label} — transfers between Bank, Cash and Mobile Banking don&apos;t count as received or spent.
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {(
              [
                ["Opening balance", statement.opening],
                ["+ Money received", statement.moneyIn],
                ["− Money spent", statement.moneyOut],
                ["= Closing balance", statement.closing],
              ] as const
            ).map(([label, value], i) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className={i === 3 ? "font-semibold tabular" : "font-medium tabular"}>{formatTaka(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {filtered && list.total > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {list.total} transaction{list.total === 1 ? "" : "s"}
          </span>
          {list.totals.moneyIn > 0 && (
            <span>
              Money in <Money value={list.totals.moneyIn} tone="income" className="font-semibold" />
            </span>
          )}
          {list.totals.moneyOut > 0 && (
            <span>
              Money out <Money value={list.totals.moneyOut} className="font-semibold" />
            </span>
          )}
          {list.totals.pending > 0 && (
            <span className="text-warning">
              Pending <Money value={list.totals.pending} className="font-semibold" /> (not deducted)
            </span>
          )}
          {!showBalance && (
            <span className="w-full text-xs text-muted-foreground">
              Running balance is hidden while filtering — it also moves with transactions not shown here (like your salary). Clear the filters to see it.
            </span>
          )}
        </div>
      )}
      {list.rows.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transactions found" description="Try changing the filters, or add an expense with Quick Add." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="relative hidden overflow-x-auto rounded-xl border bg-card lg:block">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Transaction</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 font-medium">From / into</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  {showBalance && <th className="px-3 py-2.5 text-right font-medium">Balance</th>}
                  <th className="px-3 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground tabular">{formatDate(t.date)}</td>
                    <td className="max-w-64 px-3 py-2.5">
                      <Link href={`/transactions/${t.id}`} className="font-medium hover:underline">
                        {t.incomeLabel || t.title}
                      </Link>
                      {(t.items.length > 0 || t.personName || t.bill) && (
                        <p className="truncate text-xs text-muted-foreground">
                          {[t.items.length ? `${t.items.length} items` : null, t.personName, t.bill ? "Utility bill" : null].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.categoryLabel ?? (t.type === "transfer" ? `${t.accountName} → ${t.toAccountName}` : (t.goalName ?? "—"))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{TXN_TYPE_LABELS[t.type]}</td>
                    <td className="px-3 py-2.5 text-right">
                      <TxnAmount t={t} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{t.type === "transfer" ? "—" : (t.accountName ?? PAYMENT_METHOD_LABELS[t.paymentMethod])}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={t.status} />
                    </td>
                    {showBalance && (
                      <td className="px-3 py-2.5 text-right">
                        <Money value={t.runningBalance ?? 0} tone="auto" className="text-muted-foreground" />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-0.5">
                        {t.status === "pending" && <MarkPaidButton id={t.id} dueDate={t.date} size="xs" />}
                        {!t.loanId && !t.investmentId && (
                          <>
                            {!t.type.startsWith("savings") && (
                              <ButtonLink href={`/transactions/${t.id}/edit`} variant="ghost" size="icon-xs" aria-label="Edit">
                                <Pencil />
                              </ButtonLink>
                            )}
                            <DeleteTxnButton id={t.id} title={t.incomeLabel || t.title} updatedAt={t.updatedAt} iconOnly />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <ul className="divide-y rounded-xl border bg-card lg:hidden">
            {list.rows.map((t) => (
              <li key={t.id}>
                <Link href={`/transactions/${t.id}`} className="flex items-center gap-3 px-3 py-3">
                  <TxnIcon type={t.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.incomeLabel || t.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[formatDate(t.date), t.categoryLabel ?? TXN_TYPE_LABELS[t.type], placeLabel(t)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <TxnAmount t={t} className="text-sm" />
                    {t.status === "pending" ? (
                      <StatusBadge status="pending" />
                    ) : showBalance ? (
                      <span className="text-[11px] text-muted-foreground tabular">Bal {formatTaka(Math.round((t.runningBalance ?? 0) / 100) * 100)}</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
            <p className="text-muted-foreground">
              {list.total} transaction{list.total === 1 ? "" : "s"} · page {list.page} of {list.pages}
            </p>
            <div className="flex gap-2">
              {list.page > 1 && (
                <ButtonLink href={pageHref(list.page - 1)} variant="outline" size="sm">
                  Previous
                </ButtonLink>
              )}
              {list.page < list.pages && (
                <ButtonLink href={pageHref(list.page + 1)} variant="outline" size="sm">
                  Next
                </ButtonLink>
              )}
            </div>
          </nav>
        </>
      )}
    </>
  );
}

