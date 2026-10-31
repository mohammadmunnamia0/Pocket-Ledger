import { connectDB } from "../db/connect";
import { Category, Person, PersonAllocation, Transaction, oid } from "../db/models";
import { AppError, NotFoundError } from "../errors";
import { formatMonthLong } from "../dates";
import { allocationInputSchema, personInputSchema } from "../validation";
import { createTransaction } from "./transactions";
import type { z } from "zod";

/**
 * Allocations are budget commitments ("Suraiya gets ৳2,500 for October"). They never touch
 * the cash balance. Only payments — ordinary expenses linked to the person — move money.
 * Paid amounts are always computed from those expense records.
 */

export interface PersonSummary {
  id: string;
  name: string;
  relation: string | null;
  monthlyAllocation: number;
  notes: string | null;
  archived: boolean;
  totalAllocated: number;
  totalPaid: number;
  pendingPayments: number;
  remaining: number;
}

export async function listPeople(userId: string): Promise<PersonSummary[]> {
  await connectDB();
  const uid = oid(userId);
  const [people, allocs, paid] = await Promise.all([
    Person.find({ userId: uid }).sort({ archived: 1, name: 1 }).lean(),
    PersonAllocation.aggregate<{ _id: unknown; v: number }>([
      { $match: { userId: uid } },
      { $group: { _id: "$personId", v: { $sum: "$amount" } } },
    ]),
    Transaction.aggregate<{ _id: { p: unknown; s: string }; v: number }>([
      { $match: { userId: uid, type: "expense", personId: { $type: "objectId" } } },
      { $group: { _id: { p: "$personId", s: "$status" }, v: { $sum: "$amount" } } },
    ]),
  ]);
  const allocMap = new Map(allocs.map((a) => [String(a._id), a.v]));
  return people.map((p) => {
    const id = p._id.toString();
    const totalAllocated = allocMap.get(id) ?? 0;
    const totalPaid = paid.find((x) => String(x._id.p) === id && x._id.s === "paid")?.v ?? 0;
    const pendingPayments = paid.find((x) => String(x._id.p) === id && x._id.s === "pending")?.v ?? 0;
    return {
      id,
      name: p.name,
      relation: p.relation ?? null,
      monthlyAllocation: p.monthlyAllocation,
      notes: p.notes ?? null,
      archived: p.archived,
      totalAllocated,
      totalPaid,
      pendingPayments,
      remaining: totalAllocated - totalPaid,
    };
  });
}

export interface AllocationRow {
  id: string | null;
  month: string;
  allocated: number;
  paid: number;
  pending: number;
  remaining: number;
  note: string | null;
}

export async function getPersonDetail(userId: string, personId: string) {
  await connectDB();
  const uid = oid(userId);
  const pid = oid(personId);
  const person = await Person.findOne({ _id: pid, userId: uid }).lean();
  if (!person) return null;
  const [allocs, payments] = await Promise.all([
    PersonAllocation.find({ userId: uid, personId: pid }).sort({ month: -1 }).lean(),
    Transaction.find({ userId: uid, personId: pid, type: "expense" }).sort({ date: -1, createdAt: -1 }).lean(),
  ]);

  const months = new Map<string, AllocationRow>();
  for (const a of allocs) {
    months.set(a.month, { id: a._id.toString(), month: a.month, allocated: a.amount, paid: 0, pending: 0, remaining: 0, note: a.note ?? null });
  }
  for (const t of payments) {
    const row =
      months.get(t.attributionMonth) ??
      months.set(t.attributionMonth, { id: null, month: t.attributionMonth, allocated: 0, paid: 0, pending: 0, remaining: 0, note: null }).get(t.attributionMonth)!;
    if (t.status === "paid") row.paid += t.amount;
    else row.pending += t.amount;
  }
  const rows = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  for (const r of rows) r.remaining = r.allocated - r.paid;

  return {
    person: {
      id: person._id.toString(),
      name: person.name,
      relation: person.relation ?? null,
      monthlyAllocation: person.monthlyAllocation,
      notes: person.notes ?? null,
      archived: person.archived,
    },
    allocations: rows,
    totals: {
      allocated: rows.reduce((s, r) => s + r.allocated, 0),
      paid: rows.reduce((s, r) => s + r.paid, 0),
      pending: rows.reduce((s, r) => s + r.pending, 0),
    },
    paymentIds: payments.map((p) => p._id.toString()),
  };
}

export async function savePerson(userId: string, raw: z.input<typeof personInputSchema>, id?: string): Promise<string> {
  const input = personInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  if (id) {
    const res = await Person.updateOne({ _id: oid(id), userId: uid }, { $set: input });
    if (res.matchedCount === 0) throw new NotFoundError("Person");
    return id;
  }
  const created = await Person.create({ ...input, userId: uid });
  return created._id.toString();
}

export async function setPersonArchived(userId: string, id: string, archived: boolean) {
  await connectDB();
  await Person.updateOne({ _id: oid(id), userId: oid(userId) }, { $set: { archived } });
}

export async function deletePerson(userId: string, id: string) {
  await connectDB();
  const uid = oid(userId);
  const used = await Transaction.exists({ userId: uid, personId: oid(id) });
  if (used) throw new AppError("This person has payment records. Archive them instead to keep the history.");
  await PersonAllocation.deleteMany({ userId: uid, personId: oid(id) });
  await Person.deleteOne({ _id: oid(id), userId: uid });
}

export async function saveAllocation(userId: string, raw: z.input<typeof allocationInputSchema>) {
  const input = allocationInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  const person = await Person.exists({ _id: oid(input.personId), userId: uid });
  if (!person) throw new NotFoundError("Person");
  await PersonAllocation.updateOne(
    { userId: uid, personId: oid(input.personId), month: input.month },
    { $set: { amount: input.amount, note: input.note } },
    { upsert: true },
  );
}

export async function deleteAllocation(userId: string, id: string) {
  await connectDB();
  await PersonAllocation.deleteOne({ _id: oid(id), userId: oid(userId) });
}

/** Record a payment to a person: an ordinary expense linked to the person and month. */
export async function recordPersonPayment(
  userId: string,
  input: { personId: string; amount: string; date: string; month: string; paymentMethod?: string; status?: string; notes?: string },
) {
  await connectDB();
  const uid = oid(userId);
  const person = await Person.findOne({ _id: oid(input.personId), userId: uid }, { name: 1 }).lean();
  if (!person) throw new NotFoundError("Person");
  const cat =
    (await Category.findOne({ userId: uid, systemKey: "allocation:monthly" }, { _id: 1 }).lean()) ??
    (await Category.findOne({ userId: uid, systemKey: "allocation" }, { _id: 1 }).lean());
  return createTransaction(userId, {
    type: "expense",
    title: `${person.name} — ${formatMonthLong(input.month)} allocation`,
    amount: input.amount,
    date: input.date,
    attributionMonth: input.month,
    categoryId: cat?._id.toString(),
    personId: input.personId,
    paymentMethod: (input.paymentMethod as "cash") ?? "cash",
    status: (input.status as "paid") ?? "paid",
    notes: input.notes,
  });
}

/** Remaining allocation commitments for a month (used when suggesting savings). */
export async function getOpenAllocationsForMonth(userId: string, month: string): Promise<{ personName: string; remaining: number }[]> {
  await connectDB();
  const uid = oid(userId);
  const [allocs, paid, people] = await Promise.all([
    PersonAllocation.find({ userId: uid, month }).lean(),
    Transaction.aggregate<{ _id: unknown; v: number }>([
      { $match: { userId: uid, type: "expense", status: "paid", attributionMonth: month, personId: { $type: "objectId" } } },
      { $group: { _id: "$personId", v: { $sum: "$amount" } } },
    ]),
    Person.find({ userId: uid, archived: false }, { name: 1 }).lean(),
  ]);
  return allocs
    .map((a) => {
      const p = people.find((x) => x._id.equals(a.personId));
      const done = paid.find((x) => String(x._id) === a.personId.toString())?.v ?? 0;
      return { personName: p?.name ?? "", remaining: a.amount - done };
    })
    .filter((x) => x.personName && x.remaining > 0);
}
