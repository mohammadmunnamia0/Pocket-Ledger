/**
 * Investments. An investment is a name, type, date, optional current value and note; its
 * money lives in linked transactions:
 *
 *   invested          invest_out (money leaves an account — an asset, not an expense)
 *   capital returned  invest_in  (part of what you put in came back — not income)
 *   profit            income     (earnings on top — real income)
 *
 * Returned capital and profit are recorded separately, so principal is never counted as income.
 */
import type { ClientSession } from "mongoose";
import { connectDB } from "../db/connect";
import { Investment, Transaction, oid, type InvestmentDoc, type InvestmentKind, type TransactionDoc } from "../db/models";
import { AppError, NotFoundError } from "../errors";
import { withLedger } from "../ledger/engine";
import { toInputValue } from "../money";
import { investmentInputSchema, investmentReturnSchema, type InvestmentInputRaw, type InvestmentReturnRaw } from "../validation";
import { createTransaction, deleteTransaction, updateTransaction } from "./transactions";

export interface InvestmentEntry {
  id: string;
  role: "invested" | "capital" | "profit";
  title: string;
  amount: number;
  date: string;
  accountId: string | null;
  note: string | null;
}

export interface InvestmentView {
  id: string;
  name: string;
  kind: InvestmentKind;
  date: string;
  note: string | null;
  invested: number;
  capitalReturned: number;
  profitReceived: number;
  /** Money still in the investment: invested − capital returned. */
  stillInvested: number;
  currentValue: number | null;
  /** Known when there is a current value or the capital has fully come back. */
  profitOrLoss: number | null;
  accountId: string | null;
  entries: InvestmentEntry[];
}

export interface InvestmentSummary {
  invested: number;
  stillInvested: number;
  capitalReturned: number;
  profitReceived: number;
  currentValue: number | null;
  profitOrLoss: number | null;
}

const roleOf = (t: Pick<TransactionDoc, "type">): InvestmentEntry["role"] =>
  t.type === "invest_out" ? "invested" : t.type === "invest_in" ? "capital" : "profit";

/**
 * Profit or loss = what you got back + what it is worth now − what you put in.
 * Unknown while money is still invested and no current value was entered.
 */
export function investmentProfit(v: { invested: number; capitalReturned: number; profitReceived: number; currentValue: number | null }): number | null {
  const still = v.invested - v.capitalReturned;
  if (v.currentValue === null && still > 0) return null;
  return v.capitalReturned + v.profitReceived + (v.currentValue ?? 0) - v.invested;
}

function toView(inv: InvestmentDoc, txns: TransactionDoc[]): InvestmentView {
  const entries = txns
    .map((t) => ({ id: t._id.toString(), role: roleOf(t), title: t.title, amount: t.amount, date: t.date, accountId: t.accountId?.toString() ?? null, note: t.notes ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.role === "invested" ? -1 : b.role === "invested" ? 1 : 0));
  const total = (role: InvestmentEntry["role"]) => entries.filter((e) => e.role === role).reduce((s, e) => s + e.amount, 0);
  const figures = { invested: total("invested"), capitalReturned: total("capital"), profitReceived: total("profit"), currentValue: inv.currentValue ?? null };
  return {
    id: inv._id.toString(),
    name: inv.name,
    kind: inv.kind,
    date: inv.date,
    note: inv.note ?? null,
    ...figures,
    stillInvested: figures.invested - figures.capitalReturned,
    profitOrLoss: investmentProfit(figures),
    accountId: entries.find((e) => e.role === "invested")?.accountId ?? null,
    entries,
  };
}

export async function listInvestments(userId: string): Promise<InvestmentView[]> {
  await connectDB();
  const uid = oid(userId);
  const [list, txns] = await Promise.all([
    Investment.find({ userId: uid }).sort({ date: -1, createdAt: -1 }).lean(),
    Transaction.find({ userId: uid, investmentId: { $ne: null } }).lean(),
  ]);
  return list.map((i) => toView(i, txns.filter((t) => t.investmentId?.toString() === i._id.toString())));
}

export function summarizeInvestments(list: InvestmentView[]): InvestmentSummary {
  const sum = (f: (v: InvestmentView) => number) => list.reduce((s, v) => s + f(v), 0);
  const allValued = list.every((v) => v.currentValue !== null || v.stillInvested === 0);
  const pl = list.map((v) => v.profitOrLoss);
  return {
    invested: sum((v) => v.invested),
    stillInvested: sum((v) => v.stillInvested),
    capitalReturned: sum((v) => v.capitalReturned),
    profitReceived: sum((v) => v.profitReceived),
    currentValue: allValued && list.length ? sum((v) => v.currentValue ?? 0) : null,
    profitOrLoss: pl.length && pl.every((x) => x !== null) ? pl.reduce((s, x) => s! + x!, 0) : null,
  };
}

async function load(userId: string, id: string, session: ClientSession) {
  const inv = await Investment.findOne({ _id: oid(id), userId: oid(userId) }, null, { session }).lean();
  if (!inv) throw new NotFoundError("Investment");
  const txns = await Transaction.find({ userId: oid(userId), investmentId: inv._id }, null, { session }).lean();
  return { inv, txns };
}

export async function saveInvestment(userId: string, raw: InvestmentInputRaw, id?: string): Promise<string> {
  const input = investmentInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  const meta = { name: input.name, kind: input.kind, date: input.date, currentValue: input.currentValue ?? null, note: input.note };
  const money = {
    type: "invest_out" as const,
    title: `Invested in ${input.name}`,
    amount: toInputValue(input.amount),
    date: input.date,
    accountId: input.accountId,
    paymentMethod: "other" as const,
    notes: input.note,
  };
  return withLedger(userId, async (session) => {
    if (!id) {
      const [inv] = await Investment.create([{ userId: uid, ...meta }], { session });
      await createTransaction(userId, { ...money, investmentId: inv._id.toString() }, { session, linked: true });
      return inv._id.toString();
    }
    const { inv, txns } = await load(userId, id, session);
    const view = toView(inv, txns);
    if (input.amount < view.capitalReturned) {
      throw new AppError(`${toInputValue(view.capitalReturned)} of capital has already come back — the amount can't be less than that.`);
    }
    await Investment.updateOne({ _id: inv._id }, { $set: meta }, { session });
    const [first, ...extra] = txns.filter((t) => roleOf(t) === "invested");
    if (first) await updateTransaction(userId, first._id.toString(), { ...money, investmentId: id }, { session, linked: true });
    else await createTransaction(userId, { ...money, investmentId: id }, { session, linked: true });
    for (const t of extra) await deleteTransaction(userId, t._id.toString(), { session, linked: true });
    return id;
  });
}

/** Money received from an investment: returned capital (not income) and profit (income), recorded separately. */
export async function recordInvestmentReturn(userId: string, investmentId: string, raw: InvestmentReturnRaw): Promise<void> {
  const input = investmentReturnSchema.parse(raw);
  await connectDB();
  await withLedger(userId, async (session) => {
    const { inv, txns } = await load(userId, investmentId, session);
    const view = toView(inv, txns);
    if (input.capital > view.stillInvested) {
      throw new AppError(`Only ${toInputValue(view.stillInvested)} is still invested — enter anything above that as profit.`);
    }
    if (input.date < inv.date) throw new AppError("A return can't be dated before the investment.");
    const common = { date: input.date, accountId: input.accountId, paymentMethod: "other" as const, notes: input.note, investmentId };
    if (input.capital > 0) {
      await createTransaction(userId, { ...common, type: "invest_in", title: `Capital back from ${inv.name}`, amount: toInputValue(input.capital) }, { session, linked: true });
    }
    if (input.profit > 0) {
      await createTransaction(
        userId,
        { ...common, type: "income", incomeKind: "other", incomeLabel: `Profit from ${inv.name}`, title: `Profit from ${inv.name}`, amount: toInputValue(input.profit) },
        { session, linked: true },
      );
    }
  });
}

/** Update only what the investment is worth now (no money moves). */
export async function setInvestmentValue(userId: string, id: string, value: number | null): Promise<void> {
  await connectDB();
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new AppError("Enter a valid value");
  const res = await Investment.updateOne({ _id: oid(id), userId: oid(userId) }, { $set: { currentValue: value } });
  if (res.matchedCount === 0) throw new NotFoundError("Investment");
}

export async function deleteInvestmentEntry(userId: string, investmentId: string, txnId: string): Promise<void> {
  await connectDB();
  await withLedger(userId, async (session) => {
    const { txns } = await load(userId, investmentId, session);
    const t = txns.find((x) => x._id.toString() === txnId);
    if (!t) throw new NotFoundError("Investment entry");
    if (roleOf(t) === "invested") throw new AppError("Edit the investment to change the amount, or delete the whole investment.");
    await deleteTransaction(userId, txnId, { session, linked: true });
  });
}

export async function deleteInvestment(userId: string, id: string): Promise<void> {
  await connectDB();
  await withLedger(userId, async (session) => {
    const { inv, txns } = await load(userId, id, session);
    for (const t of txns) await deleteTransaction(userId, t._id.toString(), { session, linked: true });
    await Investment.deleteOne({ _id: inv._id }, { session });
  });
}
