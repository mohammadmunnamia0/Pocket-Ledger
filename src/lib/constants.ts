/** Enum values shared by server and client code (no database imports here). */
export const TXN_TYPES = [
  "income",
  "expense",
  "transfer",
  "savings_deposit",
  "savings_withdrawal",
  // Money lent or borrowed: principal and repayments (linked to a Loan). Never income or expense.
  "loan_out",
  "loan_in",
  // Money put into an investment, and capital returned from it (linked to an Investment).
  "invest_out",
  "invest_in",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

/** Types that bring money into the spendable balance / take it out. Transfers move between own accounts. */
export const IN_TYPES: TxnType[] = ["income", "savings_withdrawal", "loan_in", "invest_in"];
export const OUT_TYPES: TxnType[] = ["expense", "savings_deposit", "loan_out", "invest_out"];
/** Created and changed only from Loans / Investments, so both records stay consistent. */
export const LINKED_TYPES: TxnType[] = ["loan_out", "loan_in", "invest_out", "invest_in"];

/** "lent": I gave money and am owed it. "borrowed": I received money and owe it. */
export const LOAN_DIRECTIONS = ["lent", "borrowed"] as const;
export type LoanDirection = (typeof LOAN_DIRECTIONS)[number];

export const INVESTMENT_KINDS = ["business", "stocks", "deposit", "property", "gold", "crypto", "other"] as const;
export type InvestmentKind = (typeof INVESTMENT_KINDS)[number];

/** The three places money is kept, shown inside the Remaining balance card. */
export const HOLDING_KINDS = ["bank", "cash", "mobile"] as const;
export type HoldingKind = (typeof HOLDING_KINDS)[number];

export const TXN_STATUSES = ["paid", "pending"] as const;
export type TxnStatus = (typeof TXN_STATUSES)[number];

export const INCOME_KINDS = ["salary", "bonus", "other", "opening"] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

export const PAYMENT_METHODS = ["cash", "bank", "card", "mobile", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ACCOUNT_KINDS = ["cash", "bank", "card", "mobile", "savings", "other"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const BILL_TYPES = ["internet", "electricity", "gas", "water", "other"] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const CATEGORY_NATURES = ["consumption", "saving"] as const;
export type CategoryNature = (typeof CATEGORY_NATURES)[number];

export const GOAL_KINDS = ["medical", "personal", "family", "future", "travel", "other"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const GOAL_STATUSES = ["active", "completed", "paused"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
