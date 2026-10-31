import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Section, StatCard, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { TxnList } from "@/components/txn-list";
import { ConfirmButton } from "@/components/confirm-button";
import { AllocationForm, PaymentForm, PersonDialog } from "@/components/people-forms";
import { requireUser } from "@/lib/auth/session";
import { getPersonDetail } from "@/lib/services/people";
import { listTransactions } from "@/lib/services/transactions";
import { isObjectId } from "@/lib/db/models";
import { formatMonthLong } from "@/lib/dates";
import { archivePersonAction, deleteAllocationAction, deletePersonAction } from "@/app/actions/ledger";

export const metadata: Metadata = { title: "Person" };

export default function PersonPage({ params }: PageProps<"/people/[id]">) {
  return (
    <>
      <Link href="/people" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Family & Allocations
      </Link>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <Person params={params} />
      </Suspense>
    </>
  );
}

async function Person({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const detail = await getPersonDetail(user.id, id);
  if (!detail) notFound();
  const { person: p, allocations, totals } = detail;
  const payments = await listTransactions(user.id, { personId: id, pageSize: 100 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
          <p className="text-sm text-muted-foreground">{[p.relation, p.archived ? "Archived" : null].filter(Boolean).join(" · ") || "Family member"}</p>
          {p.notes && <p className="mt-1 max-w-xl text-sm whitespace-pre-wrap">{p.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <PersonDialog
            person={p}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil /> Edit
              </Button>
            }
          />
          <ConfirmButton
            title={p.archived ? `Restore ${p.name}?` : `Archive ${p.name}?`}
            description={p.archived ? "They will appear in forms again." : "Archived people are hidden from forms; history is kept."}
            confirmLabel={p.archived ? "Restore" : "Archive"}
            action={archivePersonAction.bind(null, p.id, !p.archived)}
            variant="outline"
            destructive={false}
          >
            {p.archived ? <ArchiveRestore /> : <Archive />} {p.archived ? "Restore" : "Archive"}
          </ConfirmButton>
          <ConfirmButton
            title={`Delete ${p.name}?`}
            description="Only possible when no payments are recorded. Their allocations are removed too."
            action={deletePersonAction.bind(null, p.id)}
          >
            <Trash2 /> Delete
          </ConfirmButton>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total allocated" value={<Money value={totals.allocated} />} />
        <StatCard label="Total paid" value={<Money value={totals.paid} />} hint={totals.pending ? `+ pending` : undefined} />
        <StatCard label="Remaining" value={<Money value={totals.allocated - totals.paid} tone="auto" />} />
      </div>

      <Section title="Record a payment" description="Creates an expense linked to this person. It is deducted from your balance and funded from your salaries.">
        <PaymentForm personId={p.id} personName={p.name} months={allocations.map((a) => ({ month: a.month, remaining: a.remaining }))} />
      </Section>

      <Section title="Monthly allocations" description="Budget commitments — they reserve money in alerts but never change your cash balance.">
        <AllocationForm personId={p.id} defaultAmount={p.monthlyAllocation} />
        {allocations.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 text-right font-medium">Allocated</th>
                  <th className="pb-2 text-right font-medium">Paid</th>
                  <th className="pb-2 text-right font-medium">Pending</th>
                  <th className="pb-2 text-right font-medium">Remaining</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="tabular">
                {allocations.map((a) => (
                  <tr key={a.month} className="border-t">
                    <td className="py-2">
                      {formatMonthLong(a.month)}
                      {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
                    </td>
                    <td className="py-2 text-right">
                      <Money value={a.allocated} />
                    </td>
                    <td className="py-2 text-right">
                      <Money value={a.paid} />
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      <Money value={a.pending} />
                    </td>
                    <td className="py-2 text-right font-medium">
                      <Money value={a.remaining} tone="auto" />
                    </td>
                    <td className="py-2 text-right">
                      {a.id && (
                        <ConfirmButton
                          title={`Remove ${formatMonthLong(a.month)} allocation?`}
                          description="Payments already recorded are kept."
                          confirmLabel="Remove"
                          action={deleteAllocationAction.bind(null, a.id)}
                          variant="ghost"
                          size="icon-xs"
                        >
                          <Trash2 />
                          <span className="sr-only">Remove</span>
                        </ConfirmButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Payment history">
        {payments.rows.length ? <TxnList items={payments.rows} /> : <EmptyState title="No payments yet" />}
      </Section>
    </div>
  );
}
