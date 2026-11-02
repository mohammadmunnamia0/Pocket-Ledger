/**
 * How a validated input becomes a stored transaction — the defaults and derived fields.
 * Shared by the server (before saving) and the offline app (to show a queued change exactly
 * as the server will store it). Client-safe: no database imports.
 */
import type { BillType, IncomeKind, PaymentMethod, TxnStatus, TxnType } from "../constants";
import { formatMonthLong, monthOf } from "../dates";
import { sum } from "../money";
import type { TxnInput } from "../validation";

export interface DerivedTxn {
  type: TxnType;
  status: TxnStatus;
  title: string;
  amount: number;
  date: string;
  attributionMonth: string;
  categoryId: string | null;
  paymentMethod: PaymentMethod;
  accountId: string | null;
  toAccountId: string | null;
  personId: string | null;
  goalId: string | null;
  loanId: string | null;
  investmentId: string | null;
  notes: string | undefined;
  income: { kind: IncomeKind; label: string | undefined } | null;
  items: { name: string; amount: number; categoryId: string | null; notes: string | undefined }[];
  bill: {
    billType: BillType;
    rechargeDate: string | null;
    coverageFrom: string | null;
    coverageTo: string | null;
    recurringBillId: string | null;
  } | null;
  fundingSourceId: string | null;
}

/**
 * @param ctx.othersCategoryId fallback category for uncategorised expenses
 * @param ctx.defaultAccountId account used when none is chosen
 */
export function deriveTxn(input: TxnInput, ctx: { othersCategoryId: string | null; defaultAccountId: string | null }): DerivedTxn {
  const isExpense = input.type === "expense";
  const kind: IncomeKind = input.incomeKind ?? "salary";
  const attributionMonth = input.attributionMonth ?? monthOf(input.date);
  const categoryId = isExpense ? (input.categoryId ?? ctx.othersCategoryId) : null;
  return {
    type: input.type,
    // Only expenses can wait as pending; income, transfers and savings moves happen immediately.
    status: isExpense ? input.status : "paid",
    title: input.title,
    // A breakdown's total is always the sum of its items.
    amount: isExpense && input.items.length > 0 ? sum(input.items.map((i) => i.amount)) : input.amount!,
    date: input.date,
    attributionMonth,
    categoryId: categoryId ?? null,
    paymentMethod: input.paymentMethod,
    accountId: input.accountId ?? ctx.defaultAccountId,
    toAccountId: input.type === "transfer" ? (input.toAccountId ?? null) : null,
    personId: isExpense ? (input.personId ?? null) : null,
    goalId: input.type.startsWith("savings_") ? (input.goalId ?? null) : null,
    // Loan entries, and interest received on a loan (income), point at their loan.
    loanId: input.type.startsWith("loan_") || input.type === "income" ? (input.loanId ?? null) : null,
    // Investment entries, and profit received from an investment (income), point at it.
    investmentId: input.type.startsWith("invest_") || input.type === "income" ? (input.investmentId ?? null) : null,
    notes: input.notes,
    income:
      input.type === "income"
        ? { kind, label: input.incomeLabel ?? (kind === "salary" ? `${formatMonthLong(attributionMonth)} Salary` : undefined) }
        : null,
    items: isExpense ? input.items.map((i) => ({ name: i.name, amount: i.amount, categoryId: i.categoryId ?? null, notes: i.notes })) : [],
    bill:
      isExpense && input.bill
        ? {
            billType: input.bill.billType,
            rechargeDate: input.bill.rechargeDate ?? null,
            coverageFrom: input.bill.coverageFrom ?? null,
            coverageTo: input.bill.coverageTo ?? null,
            recurringBillId: input.bill.recurringBillId ?? null,
          }
        : null,
    fundingSourceId: isExpense ? (input.fundingSourceId ?? null) : null,
  };
}
