import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader, Section, TableSkeleton } from "@/components/common";
import { TransactionForm } from "@/components/transaction-form";
import { requireUser } from "@/lib/auth/session";
import { getFormContext } from "@/lib/services/forms";

export const metadata: Metadata = { title: "Add expense" };

export default function NewExpensePage() {
  return (
    <>
      <PageHeader
        title="Add expense"
        description="A simple expense, or one payment split into itemized breakdown. Use Quick Add in the top bar for the fastest entry."
      />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <NewExpense />
      </Suspense>
    </>
  );
}

async function NewExpense() {
  const user = await requireUser();
  const ctx = await getFormContext(user.id);
  return (
    <Section className="max-w-3xl">
      <TransactionForm mode="expense" lookups={ctx.lookups} defaults={ctx.defaults} />
    </Section>
  );
}
