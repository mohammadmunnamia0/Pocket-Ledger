import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { connectDB } from "../db/connect";
import {
  Account,
  Category,
  Person,
  PersonAllocation,
  Transaction,
  oid,
  BILL_TYPES,
  PAYMENT_METHODS,
  type BillType,
  type IncomeKind,
  type PaymentMethod,
} from "../db/models";
import { AppError } from "../errors";
import { formatMonthLong, isISODate, isMonth, monthOf, formatDate } from "../dates";
import { formatTaka, parseTaka } from "../money";
import { allocateFifo, type FundingConsumer, type FundingSource } from "../ledger/fifo";
import { CONSUMER_TYPES, LEDGER_START, SOURCE_TYPES, recomputeFunding, withLedger } from "../ledger/engine";

/**
 * Historical import. Rows are validated and simulated against the existing ledger before
 * anything is written; the commit re-validates on the server and writes atomically.
 * Amounts are never adjusted to make balances match — inconsistencies are reported.
 *
 * Columns: date, type, title, amount, category, subcategory, payment_method, status,
 *          month, person, notes, group, bill_type, recharge_date
 * type:    salary | bonus | income | opening | expense | bill | allocation
 * group:   rows sharing a group become one expense with a breakdown (title = group).
 */

export const IMPORT_COLUMNS = [
  "date", "type", "title", "amount", "category", "subcategory", "payment_method",
  "status", "month", "person", "notes", "group", "bill_type", "recharge_date",
] as const;

export type ImportRow = Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>;

const ROW_TYPES = ["salary", "bonus", "income", "opening", "expense", "bill", "allocation"] as const;
type RowType = (typeof ROW_TYPES)[number];

export interface PlannedEntry {
  rows: number[];
  kind: "income" | "expense" | "allocation";
  date: string;
  month: string;
  title: string;
  amount: number;
  category: string | null;
  person: string | null;
  status: "paid" | "pending";
  itemCount: number;
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  entries: PlannedEntry[];
  newCategories: string[];
  newPersons: string[];
  totals: { income: number; expenses: number; pending: number; allocations: number; transactions: number };
  openingBalance: number;
  closingBalance: number;
  issues: string[];
  canCommit: boolean;
}

interface CatRef { parent: string; child: string | null }
interface Draft {
  entry: PlannedEntry;
  rowType: RowType;
  incomeKind?: IncomeKind;
  paymentMethod: PaymentMethod;
  notes?: string;
  catRef: CatRef | null;
  personName: string | null;
  billType?: BillType;
  rechargeDate?: string | null;
  items: { name: string; amount: number; catRef: CatRef | null; notes?: string }[];
}

const norm = (s: string) => s.trim().toLowerCase();

function parseCatRef(category?: string, subcategory?: string): CatRef | null {
  const c = (category ?? "").trim();
  const s = (subcategory ?? "").trim();
  if (!c) return null;
  if (!s && c.includes(">")) {
    const [p, ...rest] = c.split(/›|>/);
    return { parent: p.trim(), child: rest.join(" ").trim() || null };
  }
  return { parent: c, child: s || null };
}

function catLabel(ref: CatRef | null) {
  return ref ? (ref.child ? `${ref.parent} › ${ref.child}` : ref.parent) : null;
}

function parseRows(rows: ImportRow[]): Draft[] {
  const drafts: Draft[] = [];
  const groups = new Map<string, Draft>();

  rows.forEach((r, idx) => {
    const rowNo = idx + 2; // header is row 1
    const errors: string[] = [];
    const type = norm(r.type ?? "") as RowType;
    if (!ROW_TYPES.includes(type)) errors.push(`Unknown type “${r.type ?? ""}”`);
    const date = (r.date ?? "").trim();
    const month = (r.month ?? "").trim();
    if (type !== "allocation" && !isISODate(date)) errors.push("Date must be YYYY-MM-DD");
    if (month && !isMonth(month)) errors.push("Month must be YYYY-MM");
    if (type === "allocation" && !isMonth(month)) errors.push("Allocation rows need a month (YYYY-MM)");
    const amount = parseTaka(r.amount ?? "");
    if (amount === null || amount <= 0) errors.push(`Invalid amount “${r.amount ?? ""}”`);
    const pm = norm(r.payment_method || "cash") as PaymentMethod;
    if (!PAYMENT_METHODS.includes(pm)) errors.push(`Unknown payment method “${r.payment_method}”`);
    const status = norm(r.status || "paid");
    if (status !== "paid" && status !== "pending") errors.push(`Status must be paid or pending`);
    if (status === "pending" && !["expense", "bill"].includes(type)) errors.push("Only expenses can be pending");
    const billType = norm(r.bill_type ?? "") as BillType;
    if (type === "bill" && !BILL_TYPES.includes(billType)) errors.push(`bill_type must be one of ${BILL_TYPES.join(", ")}`);
    const recharge = (r.recharge_date ?? "").trim();
    if (recharge && !isISODate(recharge)) errors.push("recharge_date must be YYYY-MM-DD");
    const person = (r.person ?? "").trim() || null;
    if (type === "allocation" && !person) errors.push("Allocation rows need a person");
    const title = (r.title ?? "").trim();
    if (!title && type !== "allocation" && type !== "salary") errors.push("Title is required");

    const resolvedMonth = month || (isISODate(date) ? monthOf(date) : "");
    const catRef =
      type === "bill"
        ? { parent: "Utility Bills", child: { internet: "Internet", electricity: "Electricity", gas: "Gas", water: "Water", other: "Other Bills" }[billType] ?? "Other Bills" }
        : parseCatRef(r.category, r.subcategory);
    const kind: PlannedEntry["kind"] = ["salary", "bonus", "income", "opening"].includes(type) ? "income" : type === "allocation" ? "allocation" : "expense";

    const group = (r.group ?? "").trim();
    if (group && kind === "expense") {
      const existing = groups.get(group);
      if (existing) {
        existing.entry.rows.push(rowNo);
        existing.entry.errors.push(...errors.map((e) => `Row ${rowNo}: ${e}`));
        if (existing.entry.date !== date) existing.entry.errors.push(`Row ${rowNo}: all rows in group “${group}” must share one date`);
        existing.items.push({ name: title || "Item", amount: amount ?? 0, catRef, notes: r.notes });
        existing.entry.amount += amount ?? 0;
        existing.entry.itemCount++;
        return;
      }
      const draft: Draft = {
        entry: { rows: [rowNo], kind, date, month: resolvedMonth, title: group, amount: amount ?? 0, category: catLabel(catRef), person, status: status as "paid", itemCount: 1, errors: errors.map((e) => `Row ${rowNo}: ${e}`), warnings: [] },
        rowType: type,
        paymentMethod: pm,
        catRef,
        personName: person,
        items: [{ name: title || "Item", amount: amount ?? 0, catRef, notes: r.notes }],
      };
      groups.set(group, draft);
      drafts.push(draft);
      return;
    }

    drafts.push({
      entry: {
        rows: [rowNo],
        kind,
        date: type === "allocation" ? `${month}-01` : date,
        month: resolvedMonth,
        title: title || (type === "salary" && resolvedMonth ? `${formatMonthLong(resolvedMonth)} Salary` : type === "allocation" ? `${person} allocation` : ""),
        amount: amount ?? 0,
        category: kind === "expense" ? catLabel(catRef) : null,
        person,
        status: status as "paid",
        itemCount: 0,
        errors,
        warnings: [],
      },
      rowType: type,
      incomeKind: type === "salary" ? "salary" : type === "bonus" ? "bonus" : type === "opening" ? "opening" : "other",
      paymentMethod: pm,
      notes: (r.notes ?? "").trim() || undefined,
      catRef: kind === "expense" ? catRef : null,
      personName: person,
      billType: type === "bill" ? billType : undefined,
      rechargeDate: recharge || null,
      items: [],
    });
  });
  return drafts;
}

async function plan(userId: string, rows: ImportRow[]) {
  if (rows.length === 0) throw new AppError("The file has no data rows");
  if (rows.length > 5000) throw new AppError("Import at most 5,000 rows at a time");
  await connectDB();
  const uid = oid(userId);
  const drafts = parseRows(rows);

  const [cats, people, existingTxns] = await Promise.all([
    Category.find({ userId: uid }, { name: 1, parentId: 1 }).lean(),
    Person.find({ userId: uid }, { name: 1 }).lean(),
    Transaction.find({ userId: uid }, { type: 1, status: 1, date: 1, amount: 1, title: 1, createdAt: 1 }).lean(),
  ]);

  const topByName = new Map(cats.filter((c) => !c.parentId).map((c) => [norm(c.name), c]));
  const childKey = (parentId: string, name: string) => `${parentId}|${norm(name)}`;
  const childByKey = new Map(cats.filter((c) => c.parentId).map((c) => [childKey(c.parentId!.toString(), c.name), c]));
  const newCategories = new Set<string>();
  const checkCat = (ref: CatRef | null) => {
    if (!ref) return;
    const top = topByName.get(norm(ref.parent));
    if (!top) newCategories.add(ref.parent);
    if (ref.child && (!top || !childByKey.has(childKey(top._id.toString(), ref.child)))) newCategories.add(`${ref.parent} › ${ref.child}`);
  };
  const personByName = new Map(people.map((p) => [norm(p.name), p]));
  const newPersons = new Set<string>();

  const dupKey = (date: string, amount: number, title: string) => `${date}|${amount}|${norm(title)}`;
  const existingKeys = new Set(existingTxns.map((t) => dupKey(t.date, t.amount, t.title)));

  for (const d of drafts) {
    checkCat(d.catRef);
    d.items.forEach((i) => checkCat(i.catRef));
    if (d.personName && !personByName.has(norm(d.personName))) newPersons.add(d.personName);
    if (d.entry.kind !== "allocation" && existingKeys.has(dupKey(d.entry.date, d.entry.amount, d.entry.title))) {
      d.entry.warnings.push("Looks like a duplicate of an existing transaction");
    }
  }

  // Simulate the funding ledger with existing + imported records.
  const fresh = drafts.filter((d) => d.entry.errors.length === 0 && d.entry.kind !== "allocation");
  const sources: FundingSource[] = [];
  const consumers: (FundingConsumer & { title: string })[] = [];
  for (const t of existingTxns) {
    if (t.status !== "paid") continue;
    const item = { id: t._id.toString(), date: t.date, seq: t.createdAt.getTime(), amount: t.amount, title: t.title };
    if (SOURCE_TYPES.includes(t.type)) sources.push(item);
    else if (CONSUMER_TYPES.includes(t.type)) consumers.push(item);
  }
  const baseSeq = Date.now();
  fresh.forEach((d, i) => {
    const item = { id: `new-${i}`, date: d.entry.date, seq: baseSeq + i, amount: d.entry.amount, title: d.entry.title };
    if (d.entry.kind === "income") sources.push(item);
    else if (d.entry.status === "paid") consumers.push(item);
  });
  const sim = allocateFifo(sources, consumers);
  const issues = sim.shortfalls.slice(0, 10).map((s) => {
    const c = consumers.find((x) => x.id === s.consumerId);
    return `Insufficient funds on ${formatDate(s.date)}: “${c?.title}” needs ${formatTaka(s.required)} but only ${formatTaka(s.funded)} is available. Add the salary/opening balance that covered it.`;
  });
  if (sim.shortfalls.length > 10) issues.push(`…and ${sim.shortfalls.length - 10} more funding shortfalls`);

  const totals = { income: 0, expenses: 0, pending: 0, allocations: 0, transactions: 0 };
  for (const d of drafts) {
    if (d.entry.errors.length) continue;
    if (d.entry.kind === "income") totals.income += d.entry.amount;
    else if (d.entry.kind === "allocation") totals.allocations += d.entry.amount;
    else if (d.entry.status === "pending") totals.pending += d.entry.amount;
    else totals.expenses += d.entry.amount;
    if (d.entry.kind !== "allocation") totals.transactions++;
  }
  const openingBalance = [...existingTxns].reduce(
    (s, t) => (t.status !== "paid" ? s : SOURCE_TYPES.includes(t.type) ? s + t.amount : CONSUMER_TYPES.includes(t.type) ? s - t.amount : s),
    0,
  );

  const rowErrors = drafts.some((d) => d.entry.errors.length > 0);
  return {
    drafts,
    preview: {
      entries: drafts.map((d) => d.entry),
      newCategories: [...newCategories],
      newPersons: [...newPersons],
      totals,
      openingBalance,
      closingBalance: openingBalance + totals.income - totals.expenses,
      issues,
      canCommit: !rowErrors && sim.shortfalls.length === 0,
    } satisfies ImportPreview,
  };
}

export async function previewImport(userId: string, rows: ImportRow[]): Promise<ImportPreview> {
  return (await plan(userId, rows)).preview;
}

export async function commitImport(userId: string, rows: ImportRow[]): Promise<{ batch: string; transactions: number; allocations: number }> {
  const { drafts, preview } = await plan(userId, rows);
  if (!preview.canCommit) {
    throw new AppError(preview.issues[0] ?? "Fix the highlighted rows before importing");
  }
  const uid = oid(userId);
  const batch = randomUUID();

  return withLedger(userId, async (session) => {
    // Resolve (or create) categories and people inside the same transaction.
    const cats = await Category.find({ userId: uid }, { name: 1, parentId: 1 }).session(session).lean();
    const top = new Map(cats.filter((c) => !c.parentId).map((c) => [norm(c.name), c._id as Types.ObjectId]));
    const child = new Map(cats.filter((c) => c.parentId).map((c) => [`${c.parentId}|${norm(c.name)}`, c._id as Types.ObjectId]));
    const resolveCat = async (ref: CatRef | null): Promise<Types.ObjectId | null> => {
      if (!ref) return null;
      let parentId = top.get(norm(ref.parent));
      if (!parentId) {
        const [c] = await Category.create([{ userId: uid, name: ref.parent, parentId: null, sortOrder: 500 }], { session });
        parentId = c._id;
        top.set(norm(ref.parent), parentId);
      }
      if (!ref.child) return parentId;
      const key = `${parentId}|${norm(ref.child)}`;
      let childId = child.get(key);
      if (!childId) {
        const parentNature = (await Category.findById(parentId, { nature: 1 }).session(session).lean())?.nature ?? "consumption";
        const [c] = await Category.create([{ userId: uid, name: ref.child, parentId, nature: parentNature, sortOrder: 500 }], { session });
        childId = c._id;
        child.set(key, childId);
      }
      return childId;
    };
    const people = await Person.find({ userId: uid }, { name: 1 }).session(session).lean();
    const personIds = new Map(people.map((p) => [norm(p.name), p._id as Types.ObjectId]));
    const resolvePerson = async (name: string | null) => {
      if (!name) return null;
      let id = personIds.get(norm(name));
      if (!id) {
        const [p] = await Person.create([{ userId: uid, name }], { session });
        id = p._id;
        personIds.set(norm(name), id);
      }
      return id;
    };
    const defaultAccount = (await Account.findOne({ userId: uid, isDefault: true }, { _id: 1 }).session(session).lean())?._id ?? null;

    const txnDocs = [];
    let allocations = 0;
    const base = Date.now();
    for (const [i, d] of drafts.entries()) {
      const e = d.entry;
      if (e.kind === "allocation") {
        await PersonAllocation.updateOne(
          { userId: uid, personId: await resolvePerson(d.personName), month: e.month },
          { $set: { amount: e.amount, note: d.notes } },
          { upsert: true, session },
        );
        allocations++;
        continue;
      }
      const items = [];
      for (const it of d.items) items.push({ name: it.name, amount: it.amount, categoryId: await resolveCat(it.catRef), notes: it.notes });
      txnDocs.push({
        userId: uid,
        type: e.kind,
        status: e.kind === "expense" ? e.status : "paid",
        title: e.title,
        amount: e.amount,
        date: e.date,
        attributionMonth: e.month,
        categoryId: e.kind === "expense" ? await resolveCat(d.catRef) : null,
        paymentMethod: d.paymentMethod,
        accountId: defaultAccount,
        personId: await resolvePerson(d.personName),
        notes: d.notes,
        income: e.kind === "income" ? { kind: d.incomeKind!, label: e.title } : null,
        items: items.length > 1 || d.items.length > 0 ? items : [],
        bill: d.billType ? { billType: d.billType, rechargeDate: d.rechargeDate ?? null } : null,
        importBatch: batch,
        // Preserve file order for same-day records.
        createdAt: new Date(base + i),
        updatedAt: new Date(base + i),
      });
    }
    if (txnDocs.length) {
      await Transaction.insertMany(txnDocs, { session });
      await recomputeFunding(userId, LEDGER_START, session, { reason: `Imported ${txnDocs.length} records` });
    }
    return { batch, transactions: txnDocs.length, allocations };
  });
}

/** Undo an entire import batch atomically (only possible while funding stays valid). */
export async function undoImport(userId: string, batch: string) {
  const uid = oid(userId);
  await withLedger(userId, async (session) => {
    const res = await Transaction.deleteMany({ userId: uid, importBatch: batch }, { session });
    if (res.deletedCount === 0) throw new AppError("Nothing to undo for this import");
    await recomputeFunding(userId, LEDGER_START, session, { reason: "Undid an import" });
  });
}

export function importTemplateCsv(): string {
  const lines = [
    IMPORT_COLUMNS.join(","),
    "2026-07-01,opening,Balance before tracking,5000,,,cash,paid,,,,,,",
    "2026-07-05,salary,July 2026 Salary,20000,,,bank,paid,2026-07,,,,,",
    "2026-07-06,expense,Chicken,1200,Food & Groceries,Chicken,cash,paid,,,,,,",
    "2026-07-08,bill,Electricity recharge,1000,,,mobile,paid,2026-08,,Prepaid meter,,electricity,2026-07-08",
    "2026-07-12,expense,Suraiya's Shoes,2000,Personal Expenses,Shopping,cash,paid,,,,New Market Hangout,,",
    "2026-07-12,expense,Ammar's Towel,300,Family & Household,Household Shopping,cash,paid,,,,New Market Hangout,,",
    "2026-07-12,expense,Transport Cost,500,Transport,Daily Transport,cash,paid,,,,New Market Hangout,,",
    "2026-07-12,expense,Tea Treat,300,Entertainment & Hangout,Treat,cash,paid,,,,New Market Hangout,,",
    ",allocation,,2500,,,,,2026-09,Suraiya,September allocation,,,",
  ];
  return lines.join("\n") + "\n";
}
