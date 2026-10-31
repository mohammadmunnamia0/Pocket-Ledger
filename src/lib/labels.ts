import type { AccountKind, BillType, GoalKind, IncomeKind, PaymentMethod, Priority, TxnType } from "./constants";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank: "Bank",
  card: "Card",
  mobile: "Mobile Banking",
  other: "Other",
};

export const TXN_TYPE_LABELS: Record<TxnType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  savings_deposit: "Savings deposit",
  savings_withdrawal: "Savings withdrawal",
};

export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  salary: "Salary",
  bonus: "Bonus",
  other: "Other income",
  opening: "Opening balance",
};

export const BILL_TYPE_LABELS: Record<BillType, string> = {
  internet: "Internet",
  electricity: "Electricity",
  gas: "Gas",
  water: "Water",
  other: "Other bill",
};

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  cash: "Cash",
  bank: "Bank",
  card: "Card",
  mobile: "Mobile Banking",
  savings: "Savings account",
  other: "Other",
};

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  medical: "Medical Emergency",
  personal: "Personal Savings",
  family: "Family Emergency",
  future: "Future Planning",
  travel: "Travel",
  other: "Other",
};

export const PRIORITY_LABELS: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
