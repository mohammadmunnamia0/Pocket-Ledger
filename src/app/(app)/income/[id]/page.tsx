import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Pencil, Split } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState, Meter, Section, StatCard, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { DeleteTxnButton } from "@/components/txn-actions";
import { requireUser } from "@/lib/auth/session";
import { getSalaryFundingHistory } from "@/lib/services/salary";
import { isObjectId } from "@/lib/db/models";
import { formatDate } from "@/lib/dates";
import { formatTaka, percent } from "@/lib/money";

export const metadata: Metadata = { title: "Salary funding history" };

export default function SalaryDetailPage({ params }: PageProps<"/income/[id]">) {
  return (
    <>
      <Link href="/income" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Income & Salary
      </Link>
      <Suspense fallback={<TableSkeleton rows={10} />}>
        <History params={params} />
      </Suspense>
    </>
  );
}

async function History({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const data = await getSalaryFundingHistory(user.id, id);
  if (!data) notFound();
  const { record: r, expenses } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{r.label}</h1>
          <p className="text-sm text-muted-foreground">Received {formatDate(r.date)}</p>
        </div>
        {r.type === "income" && (
          <div className="flex gap-2">
            <ButtonLink href={`/transactions/${r.id}/edit`} variant="outline" size="sm">
              <Pencil /> Edit
            </ButtonLink>
            <DeleteTxnButton id={r.id} title={r.label} redirectTo="/income" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Original amount" value={<Money value={r.amount} />} />
        <StatCard label="Total used" value={<Money value={r.used} />} hint={`${percent(r.used, r.amount)}% of this salary`} />
        <StatCard label="Remaining" value={<Money value={r.remaining} />} hint={r.exhaustedOn ? `Exhausted on ${formatDate(r.exhaustedOn)}` : r.status === "active" ? "Not used yet" : "Still available"} />
        <StatCard
          label="Carried forward"
          value={r.carriedForward !== null ? <Money value={r.carriedForward} /> : "—"}
          hint={r.nextSalaryDate ? `When the next salary arrived (${formatDate(r.nextSalaryDate)})` : "This is the latest salary"}
        />
      </div>

      <Section title="Expenses funded by this salary" description="In date order, with this salary's balance after each.">
        <Meter value={r.used} max={r.amount} className="mb-4" label="Salary used" />
        {expenses.length === 0 ? (
          <EmptyState title="Nothing spent from this salary yet" description="Older salaries are used first, so this one is untouched until they run out." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Expense</th>
                  <th className="pb-2 text-right font-medium">Amount funded</th>
                  <th className="pb-2 text-right font-medium">Salary left</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {expenses.map((e) => (
                  <tr key={e.transactionId} className="border-t">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{formatDate(e.date)}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/transactions/${e.transactionId}`} className="font-medium hover:underline">
                        {e.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {e.categoryLabel}
                        {e.split && (
                          <span className="ml-1 inline-flex items-center gap-0.5">
                            <Split className="size-3" aria-hidden /> split — {formatTaka(e.fundedAmount)} of {formatTaka(e.totalAmount)}
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="py-2 text-right">{formatTaka(e.fundedAmount)}</td>
                    <td className="py-2 text-right text-muted-foreground">{formatTaka(e.remainingAfter)}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="pt-2" colSpan={2}>
                    Total used
                  </td>
                  <td className="pt-2 text-right">{formatTaka(r.used)}</td>
                  <td className="pt-2 text-right">{formatTaka(r.remaining)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
