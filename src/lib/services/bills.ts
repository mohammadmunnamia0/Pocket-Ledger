import { connectDB } from "../db/connect";
import { RecurringBill, Transaction, oid, type BillType } from "../db/models";
import { NotFoundError } from "../errors";
import { addMonths, dateInMonth, daysBetween, monthOf, todayISO } from "../dates";
import { recurringBillInputSchema } from "../validation";
import type { z } from "zod";

/**
 * Utility bills are expense transactions carrying a `bill` sub-document, so they flow
 * through the same ledger, funding and reports as every other expense. The billing
 * month is the transaction's attributionMonth; the payment date is its date.
 */

export const BILL_LABELS: Record<BillType, string> = {
  internet: "Internet",
  electricity: "Electricity",
  gas: "Gas",
  water: "Water",
  other: "Other bill",
};

export interface RecurringBillDTO {
  id: string;
  title: string;
  billType: BillType;
  expectedAmount: number;
  dueDay: number;
  active: boolean;
  notes: string | null;
}

export async function listRecurringBills(userId: string): Promise<RecurringBillDTO[]> {
  await connectDB();
  const rows = await RecurringBill.find({ userId: oid(userId) }).sort({ active: -1, dueDay: 1 }).lean();
  return rows.map((r) => ({
    id: r._id.toString(),
    title: r.title,
    billType: r.billType,
    expectedAmount: r.expectedAmount,
    dueDay: r.dueDay,
    active: r.active,
    notes: r.notes ?? null,
  }));
}

export async function saveRecurringBill(userId: string, raw: z.input<typeof recurringBillInputSchema>, id?: string) {
  const input = recurringBillInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  if (id) {
    const res = await RecurringBill.updateOne({ _id: oid(id), userId: uid }, { $set: input });
    if (res.matchedCount === 0) throw new NotFoundError("Recurring bill");
    return id;
  }
  return (await RecurringBill.create({ ...input, userId: uid }))._id.toString();
}

export async function deleteRecurringBill(userId: string, id: string) {
  await connectDB();
  await RecurringBill.deleteOne({ _id: oid(id), userId: oid(userId) });
}

export interface UpcomingBill {
  recurringBillId: string;
  title: string;
  billType: BillType;
  billingMonth: string;
  dueDate: string;
  expectedAmount: number;
  daysLeft: number;
}

/**
 * Recurring bills with no bill recorded (paid or pending) for their billing month.
 * Looks at the current and next month so early recharges are not flagged twice.
 */
export async function getUpcomingBills(userId: string, today: string = todayISO(), horizonDays = 35): Promise<UpcomingBill[]> {
  await connectDB();
  const uid = oid(userId);
  const thisMonth = monthOf(today);
  const months = [addMonths(thisMonth, -1), thisMonth, addMonths(thisMonth, 1)];
  const [templates, recorded] = await Promise.all([
    RecurringBill.find({ userId: uid, active: true }).lean(),
    Transaction.find(
      { userId: uid, type: "expense", bill: { $ne: null }, attributionMonth: { $in: months } },
      { bill: 1, attributionMonth: 1 },
    ).lean(),
  ]);

  const out: UpcomingBill[] = [];
  for (const t of templates) {
    for (const month of months) {
      const covered = recorded.some(
        (r) =>
          r.attributionMonth === month &&
          (r.bill?.recurringBillId?.equals(t._id) || (!r.bill?.recurringBillId && r.bill?.billType === t.billType)),
      );
      if (covered) continue;
      const dueDate = dateInMonth(month, t.dueDay);
      const daysLeft = daysBetween(today, dueDate);
      // Last month's unpaid bill is overdue; future bills only within the horizon.
      if (daysLeft > horizonDays || (month < thisMonth && daysLeft < -31)) continue;
      out.push({
        recurringBillId: t._id.toString(),
        title: t.title,
        billType: t.billType,
        billingMonth: month,
        dueDate,
        expectedAmount: t.expectedAmount,
        daysLeft,
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Per-type totals of paid bills by billing month for a year. */
export async function getBillSummary(userId: string, year: string) {
  await connectDB();
  const rows = await Transaction.aggregate<{ _id: { t: BillType; m: string }; v: number; n: number }>([
    { $match: { userId: oid(userId), type: "expense", bill: { $ne: null }, attributionMonth: { $regex: `^${year}-` } } },
    { $group: { _id: { t: "$bill.billType", m: "$attributionMonth" }, v: { $sum: "$amount" }, n: { $sum: 1 } } },
  ]);
  return rows.map((r) => ({ billType: r._id.t, month: r._id.m, total: r.v, count: r.n }));
}
