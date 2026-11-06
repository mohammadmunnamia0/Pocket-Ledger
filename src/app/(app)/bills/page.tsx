import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { CalendarCheck, CalendarClock, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Section, StatusBadge, TableSkeleton } from "@/components/common";
import { Money } from "@/components/money";
import { ConfirmButton } from "@/components/confirm-button";
import { BillDialog, RecurringBillDialog } from "@/components/bill-forms";
import { MarkPaidButton } from "@/components/txn-actions";
import { requireUser } from "@/lib/auth/session";
import { getBillSummary, getUpcomingBills, listRecurringBills } from "@/lib/services/bills";
import { listTransactions } from "@/lib/services/transactions";
import { getFormContext } from "@/lib/services/forms";
import { BILL_TYPES } from "@/lib/constants";
import { BILL_TYPE_LABELS } from "@/lib/labels";
import { formatDate, formatMonth, formatMonthLong, monthOf } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { deleteRecurringBillAction } from "@/app/actions/ledger";

export const metadata: Metadata = { title: "Utility Bills" };

export default function BillsPage() {
  return (
    <>
      <PageHeader title="Utility Bills" help="bills" description="Internet, electricity, gas and other bills — with recharge dates, coverage periods and reminders." />
      <Suspense fallback={<TableSkeleton rows={10} />}>
        <Bills />
      </Suspense>
    </>
  );
}

async function Bills() {
  const user = await requireUser();
  const ctx = await getFormContext(user.id);
  const year = ctx.defaults.date.slice(0, 4);
  const [upcoming, templates, history, summary] = await Promise.all([
    getUpcomingBills(user.id, ctx.defaults.date),
    listRecurringBills(user.id),
    listTransactions(user.id, { billOnly: true, pageSize: 100 }, ctx.raw),
    getBillSummary(user.id, year),
  ]);
  const utilityCat = (type: string) => ctx.raw.categories.find((c) => c.systemKey === `utility:${type}`)?.id ?? null;
  const thisMonth = monthOf(ctx.defaults.date);
  const typesInYear = BILL_TYPES.filter((t) => summary.some((s) => s.billType === t));
  const monthsInYear = [...new Set(summary.map((s) => s.month))].sort();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <BillDialog
          lookups={ctx.lookups}
          defaults={{ ...ctx.defaults, categoryId: utilityCat("internet"), bill: { billType: "internet", month: thisMonth } }}
          trigger={
            <Button>
              <Plus /> Record bill
            </Button>
          }
        />
        <RecurringBillDialog
          trigger={
            <Button variant="outline">
              <CalendarClock /> Add recurring bill
            </Button>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Upcoming & overdue" help="upcomingBills" description="Recurring bills with nothing recorded for their billing month yet.">
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="All caught up" description={templates.length ? "Every recurring bill is recorded for its month." : "Add recurring bills to get reminders."} />
          ) : (
            <ul className="divide-y">
              {upcoming.map((b) => (
                <li key={`${b.recurringBillId}-${b.billingMonth}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {b.title} <span className="text-xs font-normal text-muted-foreground">· {formatMonthLong(b.billingMonth)}</span>
                    </p>
                    <p className={`text-xs ${b.daysLeft < 0 ? "text-critical" : "text-muted-foreground"}`}>
                      {b.daysLeft < 0 ? `Overdue by ${-b.daysLeft} days` : b.daysLeft === 0 ? "Due today" : `Due ${formatDate(b.dueDate)} (${b.daysLeft} days)`} · est.{" "}
                      {formatTaka(b.expectedAmount)}
                    </p>
                  </div>
                  <BillDialog
                    title={`Record ${b.title}`}
                    lookups={ctx.lookups}
                    defaults={{
                      ...ctx.defaults,
                      categoryId: utilityCat(b.billType),
                      bill: { billType: b.billType, month: b.billingMonth, amount: b.expectedAmount, title: b.title, recurringBillId: b.recurringBillId },
                    }}
                    trigger={
                      <Button size="sm" variant="outline">
                        Record payment
                      </Button>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recurring bills" help="recurringBills">
          {templates.length === 0 ? (
            <EmptyState icon={Zap} title="No recurring bills" description="E.g. Internet ৳1,000 due on the 10th every month." />
          ) : (
            <ul className="divide-y">
              {templates.map((t) => (
                <li key={t.id} className={`flex items-center gap-3 py-2.5 ${t.active ? "" : "opacity-60"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {BILL_TYPE_LABELS[t.billType]} · due day {t.dueDay} · {formatTaka(t.expectedAmount)}
                      {!t.active && " · paused"}
                    </p>
                  </div>
                  <RecurringBillDialog
                    bill={t}
                    trigger={
                      <Button variant="ghost" size="icon-xs" aria-label="Edit">
                        <Pencil />
                      </Button>
                    }
                  />
                  <ConfirmButton title={`Remove ${t.title}?`} description="Recorded bills are kept." confirmLabel="Remove" action={deleteRecurringBillAction.bind(null, t.id)} variant="ghost" size="icon-xs">
                    <Trash2 />
                    <span className="sr-only">Remove</span>
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {typesInYear.length > 0 && (
        <Section title={`${year} by billing month`} description="Totals by the month each bill belongs to (not when it was paid).">
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Month</th>
                  {typesInYear.map((t) => (
                    <th key={t} className="pb-2 text-right font-medium">
                      {BILL_TYPE_LABELS[t]}
                    </th>
                  ))}
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {monthsInYear.map((m) => (
                  <tr key={m} className="border-t">
                    <td className="py-2">{formatMonth(m)}</td>
                    {typesInYear.map((t) => (
                      <td key={t} className="py-2 text-right">
                        {formatTaka(summary.filter((s) => s.month === m && s.billType === t).reduce((a, s) => a + s.total, 0))}
                      </td>
                    ))}
                    <td className="py-2 text-right font-medium">{formatTaka(summary.filter((s) => s.month === m).reduce((a, s) => a + s.total, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Bill history">
        {history.rows.length === 0 ? (
          <EmptyState title="No bills recorded yet" />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Bill</th>
                  <th className="pb-2 font-medium">Billing month</th>
                  <th className="pb-2 font-medium">Paid / due</th>
                  <th className="pb-2 font-medium">Recharge</th>
                  <th className="pb-2 font-medium">Coverage</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="py-2 pr-3">
                      <Link href={`/transactions/${t.id}`} className="font-medium hover:underline">
                        {t.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">{t.bill ? BILL_TYPE_LABELS[t.bill.billType] : ""}</p>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatMonth(t.attributionMonth)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{formatDate(t.bill?.rechargeDate)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {t.bill?.coverageFrom || t.bill?.coverageTo ? `${formatDate(t.bill?.coverageFrom)} – ${formatDate(t.bill?.coverageTo)}` : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {t.status === "pending" ? <MarkPaidButton id={t.id} dueDate={t.date} size="xs" /> : <StatusBadge status="paid" />}
                    </td>
                    <td className="py-2 text-right">
                      <Money value={t.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
