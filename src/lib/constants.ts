/** Enum values shared by server and client code (no database imports here). */
export const TXN_TYPES = ["income", "expense", "transfer", "savings_deposit", "savings_withdrawal"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

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
