import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Section, TableSkeleton } from "@/components/common";
import { TransactionForm } from "@/components/transaction-form";
import { requireUser } from "@/lib/auth/session";
import { getTransactionDetail } from "@/lib/services/transactions";
import { getFormContext } from "@/lib/services/forms";
import { isObjectId } from "@/lib/db/models";

export const metadata: Metadata = { title: "Edit transaction" };

export default function EditTransactionPage({ params }: PageProps<"/transactions/[id]/edit">) {
  return (
    <>
      <PageHeader
        title="Edit transaction"
        help="transactionDetail"
        description="Saving recalculates balances, salary funding and reports for everything after this date."
      />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <EditForm params={params} />
      </Suspense>
    </>
  );
}

async function EditForm({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const [detail, ctx] = await Promise.all([getTransactionDetail(user.id, id), getFormContext(user.id)]);
  if (!detail) notFound();
  const t = detail.txn;
  if (t.loanId || t.investmentId) {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          This entry belongs to {t.loanId ? "a loan — change it from Lending & Borrowing" : "an investment — change it from Investments"}, so the
          {t.loanId ? " loan" : " investment"} and your balances stay consistent.
        </p>
      </Section>
    );
  }
  if (t.type.startsWith("savings")) {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          Savings deposits and withdrawals can&apos;t be edited — delete it and record the correct amount from the savings goal page.
        </p>
      </Section>
    );
  }
  return (
    <Section className="max-w-3xl">
      <TransactionForm
        mode={t.type as "expense" | "income" | "transfer"}
        lookups={{ ...ctx.lookups, incomes: ctx.lookups.incomes.filter((i) => i.id !== t.id) }}
        defaults={ctx.defaults}
        initial={t}
        redirectTo={`/transactions/${t.id}`}
      />
    </Section>
  );
}
