/**
 * Lending & Borrowing. A loan is a person + dates + note; its money lives in linked
 * transactions, so account balances, the salary ledger and the loan always agree:
 *
 *   lent      principal = loan_out (money leaves an account — not an expense)
 *             repayment = loan_in  (money comes back — not income); interest = income
 *   borrowed  principal = loan_in  (money arrives — not income or salary)
 *             repayment = loan_out (money leaves — not an expense); interest = expense
 *
 * Every change runs in one database transaction with the FIFO ledger update.
 */
import type { ClientSession } from "mongoose";
import { connectDB } from "../db/connect";
import { Category, Loan, Transaction, oid, type LoanDirection, type LoanDoc, type TransactionDoc, type TxnType } from "../db/models";
import { AppError, NotFoundError } from "../errors";
import { withLedger } from "../ledger/engine";
import { toInputValue } from "../money";
import { loanInputSchema, loanRepaymentSchema, type LoanInputRaw, type LoanRepaymentRaw } from "../validation";
import { createTransaction, deleteTransaction, updateTransaction } from "./transactions";

export type LoanStatus = "outstanding" | "partial" | "repaid";

export interface LoanEntry {
  id: string;
  role: "principal" | "repayment" | "interest";
  title: string;
  amount: number;
  date: string;
  accountId: string | null;
  note: string | null;
}

export interface LoanView {
  id: string;
  direction: LoanDirection;
  person: string;
  date: string;
  dueDate: string | null;
  note: string | null;
  principal: number;
  repaid: number;
  interest: number;
  outstanding: number;
  status: LoanStatus;
  accountId: string | null;
  overdue: boolean;
  entries: LoanEntry[];
}

export interface LoanSummary {
  total: number;
  repaid: number;
  outstanding: number;
  interest: number;
  byPerson: { person: string; outstanding: number; nextDue: string | null }[];
}

const principalType = (d: LoanDirection): TxnType => (d === "lent" ? "loan_out" : "loan_in");
const repaymentType = (d: LoanDirection): TxnType => (d === "lent" ? "loan_in" : "loan_out");

export function loanStatus(principal: number, repaid: number): LoanStatus {
  if (repaid >= principal) return "repaid";
  return repaid > 0 ? "partial" : "outstanding";
}

function roleOf(t: Pick<TransactionDoc, "type">, direction: LoanDirection): LoanEntry["role"] {
  if (t.type === principalType(direction)) return "principal";
  if (t.type === repaymentType(direction)) return "repayment";
  return "interest";
}

function toView(loan: LoanDoc, txns: TransactionDoc[], today: string): LoanView {
  const entries = txns
    .map((t) => ({
      id: t._id.toString(),
      role: roleOf(t, loan.direction),
      title: t.title,
      amount: t.amount,
      date: t.date,
      accountId: t.accountId?.toString() ?? null,
      note: t.notes ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.role === "principal" ? -1 : b.role === "principal" ? 1 : 0));
  const total = (role: LoanEntry["role"]) => entries.filter((e) => e.role === role).reduce((s, e) => s + e.amount, 0);
  const principal = total("principal");
  const repaid = total("repayment");
  const outstanding = Math.max(0, principal - repaid);
  return {
    id: loan._id.toString(),
    direction: loan.direction,
    person: loan.person,
    date: loan.date,
    dueDate: loan.dueDate ?? null,
    note: loan.note ?? null,
    principal,
    repaid,
    interest: total("interest"),
    outstanding,
    status: loanStatus(principal, repaid),
    accountId: entries.find((e) => e.role === "principal")?.accountId ?? null,
    overdue: !!loan.dueDate && loan.dueDate < today && outstanding > 0,
    entries,
  };
}

export async function listLoans(userId: string, today: string): Promise<LoanView[]> {
  await connectDB();
  const uid = oid(userId);
  const [loans, txns] = await Promise.all([
    Loan.find({ userId: uid }).sort({ date: -1, createdAt: -1 }).lean(),
    Transaction.find({ userId: uid, loanId: { $ne: null } }).lean(),
  ]);
  return loans.map((l) => toView(l, txns.filter((t) => t.loanId?.toString() === l._id.toString()), today));
}

export async function getLoan(userId: string, id: string, today: string): Promise<LoanView | null> {
  await connectDB();
  const uid = oid(userId);
  const loan = await Loan.findOne({ _id: oid(id), userId: uid }).lean();
  if (!loan) return null;
  return toView(loan, await Transaction.find({ userId: uid, loanId: loan._id }).lean(), today);
}

/** Totals for one direction; open loans only in the per-person list. */
export function summarizeLoans(loans: LoanView[], direction: LoanDirection): LoanSummary {
  const mine = loans.filter((l) => l.direction === direction);
  const people = new Map<string, { person: string; outstanding: number; nextDue: string | null }>();
  for (const l of mine) {
    if (l.outstanding === 0) continue;
    const key = l.person.trim().toLowerCase();
    const p = people.get(key) ?? { person: l.person, outstanding: 0, nextDue: null };
    p.outstanding += l.outstanding;
    if (l.dueDate && (!p.nextDue || l.dueDate < p.nextDue)) p.nextDue = l.dueDate;
    people.set(key, p);
  }
  return {
    total: mine.reduce((s, l) => s + l.principal, 0),
    repaid: mine.reduce((s, l) => s + Math.min(l.repaid, l.principal), 0),
    outstanding: mine.reduce((s, l) => s + l.outstanding, 0),
    interest: mine.reduce((s, l) => s + l.interest, 0),
    byPerson: [...people.values()].sort((a, b) => b.outstanding - a.outstanding),
  };
}

async function loadLoan(userId: string, id: string, session: ClientSession) {
  const loan = await Loan.findOne({ _id: oid(id), userId: oid(userId) }, null, { session }).lean();
  if (!loan) throw new NotFoundError("Loan");
  const txns = await Transaction.find({ userId: oid(userId), loanId: loan._id }, null, { session }).lean();
  return { loan, txns };
}

const principalTitle = (d: LoanDirection, person: string) => (d === "lent" ? `Lent to ${person}` : `Borrowed from ${person}`);

/** Record a new loan, or change one (person, dates, note, amount, account). */
export async function saveLoan(userId: string, raw: LoanInputRaw, id?: string): Promise<string> {
  const input = loanInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  const principal = {
    type: principalType(input.direction),
    title: principalTitle(input.direction, input.person),
    amount: toInputValue(input.amount),
    date: input.date,
    accountId: input.accountId,
    paymentMethod: "other" as const,
    notes: input.note,
  };

  return withLedger(userId, async (session) => {
    if (!id) {
      const [loan] = await Loan.create(
        [{ userId: uid, direction: input.direction, person: input.person, date: input.date, dueDate: input.dueDate ?? null, note: input.note }],
        { session },
      );
      await createTransaction(userId, { ...principal, loanId: loan._id.toString() }, { session, linked: true });
      return loan._id.toString();
    }

    const { loan, txns } = await loadLoan(userId, id, session);
    if (loan.direction !== input.direction) throw new AppError("A loan can't switch between lent and borrowed. Delete it and record it again.");
    const view = toView(loan, txns, input.date);
    if (input.amount < view.repaid) {
      throw new AppError(`${loan.direction === "lent" ? "You have already been repaid" : "You have already repaid"} ${toInputValue(view.repaid)} — the amount can't be less than that.`);
    }
    await Loan.updateOne({ _id: loan._id }, { $set: { person: input.person, date: input.date, dueDate: input.dueDate ?? null, note: input.note } }, { session });
    const principals = txns.filter((t) => roleOf(t, loan.direction) === "principal");
    const [first, ...extra] = principals;
    if (first) await updateTransaction(userId, first._id.toString(), { ...principal, loanId: id }, { session, linked: true });
    else await createTransaction(userId, { ...principal, loanId: id }, { session, linked: true });
    for (const t of extra) await deleteTransaction(userId, t._id.toString(), { session, linked: true });
    return id;
  });
}

/** A (partial or full) repayment, plus optional interest recorded separately as income / expense. */
export async function recordLoanRepayment(userId: string, loanId: string, raw: LoanRepaymentRaw): Promise<void> {
  const input = loanRepaymentSchema.parse(raw);
  await connectDB();
  await withLedger(userId, async (session) => {
    const { loan, txns } = await loadLoan(userId, loanId, session);
    const view = toView(loan, txns, input.date);
    if (input.amount > view.outstanding) {
      throw new AppError(`Only ${toInputValue(view.outstanding)} is still outstanding on this loan.`);
    }
    if (input.date < loan.date) throw new AppError("A repayment can't be dated before the loan.");
    const lent = loan.direction === "lent";
    await createTransaction(
      userId,
      {
        type: repaymentType(loan.direction),
        title: lent ? `Repayment from ${loan.person}` : `Repayment to ${loan.person}`,
        amount: toInputValue(input.amount),
        date: input.date,
        accountId: input.accountId,
        paymentMethod: "other",
        notes: input.note,
        loanId,
      },
      { session, linked: true },
    );
    if (input.interest > 0) {
      const others = lent ? null : await Category.findOne({ userId: oid(userId), systemKey: "others" }, { _id: 1 }, { session }).lean();
      await createTransaction(
        userId,
        lent
          ? { type: "income", incomeKind: "other", incomeLabel: `Interest from ${loan.person}`, title: `Interest from ${loan.person}`, amount: toInputValue(input.interest), date: input.date, accountId: input.accountId, paymentMethod: "other", loanId }
          : { type: "expense", title: `Interest to ${loan.person}`, amount: toInputValue(input.interest), date: input.date, accountId: input.accountId, paymentMethod: "other", categoryId: others?._id.toString(), loanId },
        { session, linked: true },
      );
    }
  });
}

/** Remove one repayment or interest entry (the principal is changed by editing the loan). */
export async function deleteLoanEntry(userId: string, loanId: string, txnId: string): Promise<void> {
  await connectDB();
  await withLedger(userId, async (session) => {
    const { loan, txns } = await loadLoan(userId, loanId, session);
    const t = txns.find((x) => x._id.toString() === txnId);
    if (!t) throw new NotFoundError("Loan entry");
    if (roleOf(t, loan.direction) === "principal") throw new AppError("Edit the loan to change its amount, or delete the whole loan.");
    await deleteTransaction(userId, txnId, { session, linked: true });
  });
}

/** Delete a loan and all of its money entries together. Refused if that would leave spending unfunded. */
export async function deleteLoan(userId: string, loanId: string): Promise<void> {
  await connectDB();
  await withLedger(userId, async (session) => {
    const { loan, txns } = await loadLoan(userId, loanId, session);
    for (const t of txns) await deleteTransaction(userId, t._id.toString(), { session, linked: true });
    await Loan.deleteOne({ _id: loan._id }, { session });
  });
}
