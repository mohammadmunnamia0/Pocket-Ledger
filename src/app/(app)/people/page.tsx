import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Meter, PageHeader, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { PersonDialog } from "@/components/people-forms";
import { requireUser } from "@/lib/auth/session";
import { listPeople } from "@/lib/services/people";
import { formatTaka } from "@/lib/money";

export const metadata: Metadata = { title: "Family & Allocations" };

export default function PeoplePage() {
  return (
    <>
      <PageHeader
        title="Family & Allocations"
        description="Allocations are commitments, not expenses — your balance only changes when a payment is made."
        actions={
          <PersonDialog
            trigger={
              <Button>
                <Plus /> Add person
              </Button>
            }
          />
        }
      />
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <People />
      </Suspense>
    </>
  );
}

async function People() {
  const user = await requireUser();
  const people = await listPeople(user.id);
  if (people.length === 0) {
    return <EmptyState title="No people yet" description="Add a family member (e.g. Suraiya) to track monthly allocations and payments." />;
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {people.map((p) => (
        <li key={p.id}>
          <Link href={`/people/${p.id}`} className={`block rounded-xl border bg-card p-4 hover:bg-muted/40 ${p.archived ? "opacity-60" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.archived ? "Archived" : p.relation}</p>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Allocated</dt>
                <dd className="font-medium">
                  <Money value={p.totalAllocated} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Paid</dt>
                <dd className="font-medium">
                  <Money value={p.totalPaid} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Remaining</dt>
                <dd className="font-medium">
                  <Money value={p.remaining} tone="auto" />
                </dd>
              </div>
            </dl>
            <Meter value={p.totalPaid} max={p.totalAllocated} className="mt-3 h-1.5" label="Paid of allocated" />
            {p.pendingPayments > 0 && <p className="mt-2 text-xs text-warning">{formatTaka(p.pendingPayments)} pending</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
