import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Pencil } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState, Section, StatusBadge, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { TxnAmount } from "@/components/txn-list";
import { DeleteTxnButton, MarkPaidButton } from "@/components/txn-actions";
import { HelpButton } from "@/components/help";
import { requireUser } from "@/lib/auth/session";
import { getTransactionDetail } from "@/lib/services/transactions";
import { isObjectId } from "@/lib/db/models";
import { formatDate, formatMonth } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { BILL_TYPE_LABELS, INCOME_KIND_LABELS, PAYMENT_METHOD_LABELS, TXN_TYPE_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Transaction" };

export default function TransactionPage({ params }: PageProps<"/transactions/[id]">) {
  return (
    <>
      <Link href="/transactions" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Transactions
      </Link>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <Detail params={params} />
      </Suspense>
    </>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const detail = await getTransactionDetail(user.id, id);
  if (!detail) notFound();
  const { txn: t, fundedBy, funds } = detail;
  const title = t.incomeLabel || t.title;

  const rows: [string, React.ReactNode][] = [
    ["Type", t.incomeKind ? `${TXN_TYPE_LABELS[t.type]} · ${INCOME_KIND_LABELS[t.incomeKind]}` : TXN_TYPE_LABELS[t.type]],
    [t.status === "pending" ? "Due date" : t.type === "income" ? "Received" : "Date", formatDate(t.date)],
    [t.type === "income" ? "Salary month" : "Belongs to month", formatMonth(t.attributionMonth)],
  ];
  if (t.categoryLabel) rows.push(["Category", t.categoryLabel]);
  if (t.type === "transfer") rows.push(["Accounts", `${t.accountName ?? "—"} → ${t.toAccountName ?? "—"}`]);
  else if (t.accountName) rows.push([t.type === "income" ? "Received into" : "Account", t.accountName]);
  if (t.type !== "transfer") rows.push(["Payment method", PAYMENT_METHOD_LABELS[t.paymentMethod]]);
  if (t.personName) rows.push(["Person", <Link key="p" href={`/people/${t.personId}`} className="hover:underline">{t.personName}</Link>]);
  if (t.goalName) rows.push(["Savings goal", <Link key="g" href={`/savings/${t.goalId}`} className="hover:underline">{t.goalName}</Link>]);
  if (t.bill) {
    rows.push(["Bill type", BILL_TYPE_LABELS[t.bill.billType]]);
    if (t.bill.rechargeDate) rows.push(["Recharge date", formatDate(t.bill.rechargeDate)]);
    if (t.bill.coverageFrom || t.bill.coverageTo) rows.push(["Coverage", `${formatDate(t.bill.coverageFrom)} – ${formatDate(t.bill.coverageTo)}`]);
  }
  if (t.notes) rows.push(["Notes", <span key="n" className="whitespace-pre-wrap">{t.notes}</span>]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <HelpButton topic="transactionDetail" />
          </div>
          <div className="mt-1 flex items-center gap-3">
            <TxnAmount t={t} className="text-2xl font-semibold" />
            <StatusBadge status={t.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.status === "pending" && <MarkPaidButton id={t.id} dueDate={t.date} />}
          {!t.type.startsWith("savings") && (
            <ButtonLink href={`/transactions/${t.id}/edit`} variant="outline" size="sm">
              <Pencil /> Edit
            </ButtonLink>
          )}
          <DeleteTxnButton id={t.id} title={title} updatedAt={t.updatedAt} redirectTo="/transactions" />
        </div>
      </div>

      <Section title="Details">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {t.items.length > 0 && (
        <Section title="Breakdown" description="The total is the sum of these items — reports count the items, never the parent twice.">
          <table className="w-full text-sm">
            <tbody>
              {t.items.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="py-2">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{[i.categoryLabel ?? t.categoryLabel, i.notes].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="py-2 text-right">
                    <Money value={i.amount} />
                  </td>
                </tr>
              ))}
              <tr>
                <td className="pt-2 font-medium">Total</td>
                <td className="pt-2 text-right font-semibold">
                  <Money value={t.amount} />
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      {(t.type === "expense" || t.type === "savings_deposit") && (
        <Section title="Funded by" description="Which salary paid for this, using the oldest available money first (FIFO).">
          {t.status === "pending" ? (
            <EmptyState title="Not funded yet" description="Pending payments don't use any salary until they're marked paid." />
          ) : (
            <ul className="divide-y text-sm">
              {fundedBy.map((f) => (
                <li key={f.transactionId} className="flex items-center justify-between py-2">
                  <Link href={`/income/${f.transactionId}`} className="hover:underline">
                    {f.title} <span className="text-xs text-muted-foreground">· received {formatDate(f.date)}</span>
                  </Link>
                  <Money value={f.amount} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {(t.type === "income" || t.type === "savings_withdrawal") && (
        <Section
          title="Spending funded by this money"
          description={`${formatTaka(funds.reduce((s, f) => s + f.amount, 0))} used of ${formatTaka(t.amount)}`}
          actions={
            t.type === "income" ? (
              <Link href={`/income/${t.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                Full funding history
              </Link>
            ) : null
          }
        >
          {funds.length === 0 ? (
            <EmptyState title="Untouched" description="Nothing has been spent from this yet." />
          ) : (
            <ul className="divide-y text-sm">
              {funds.slice(0, 12).map((f) => (
                <li key={f.transactionId} className="flex items-center justify-between py-2">
                  <Link href={`/transactions/${f.transactionId}`} className="hover:underline">
                    {f.title} <span className="text-xs text-muted-foreground">· {formatDate(f.date)}</span>
                  </Link>
                  <Money value={f.amount} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
