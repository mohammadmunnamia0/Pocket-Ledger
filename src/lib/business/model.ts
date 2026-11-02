/**
 * The Business Accounting System — one implementation for every business (Alwin BD,
 * ReturnHex, Naire). Pure functions only (no database), so the same rules run on the server,
 * in tests and in the browser.
 *
 * A business has an opening balance (money available when its records begin — not income,
 * not investment) and transactions that are either money in or money out. The available
 * balance is always: opening balance + money in − money out.
 */

/* ------------------------------------------------------------------ Transaction kinds */

export const BUSINESS_IN_KINDS = ["owner_investment", "income", "other_in"] as const;
export const BUSINESS_OUT_KINDS = [
  "expense",
  "product_purchase",
  "supplier_payment",
  "inventory",
  "marketing",
  "domain_hosting",
  "other_out",
] as const;
/** Money between two of your businesses — always recorded on both, as one linked pair. */
export const INTER_BUSINESS_KINDS = ["investment", "transfer", "loan_repayment"] as const;
export const LINKED_IN_KINDS = ["investment_from_business", "transfer_from_business", "repayment_from_business"] as const;
export const LINKED_OUT_KINDS = ["investment_in_business", "transfer_to_business", "repayment_to_business"] as const;

export type BusinessInKind = (typeof BUSINESS_IN_KINDS)[number] | (typeof LINKED_IN_KINDS)[number];
export type BusinessOutKind = (typeof BUSINESS_OUT_KINDS)[number] | (typeof LINKED_OUT_KINDS)[number];
export type BusinessTxnKind = BusinessInKind | BusinessOutKind;
export type InterBusinessKind = (typeof INTER_BUSINESS_KINDS)[number];
export type BusinessDirection = "in" | "out";

export const ALL_BUSINESS_KINDS: BusinessTxnKind[] = [...BUSINESS_IN_KINDS, ...LINKED_IN_KINDS, ...BUSINESS_OUT_KINDS, ...LINKED_OUT_KINDS];

export const BUSINESS_KIND_LABELS: Record<BusinessTxnKind, string> = {
  owner_investment: "Owner investment",
  income: "Business income",
  other_in: "Other receipt",
  investment_from_business: "Investment from another business",
  transfer_from_business: "Transfer from another business",
  repayment_from_business: "Inter-business loan repaid to us",
  expense: "Business expense",
  product_purchase: "Product purchase",
  supplier_payment: "Supplier payment",
  inventory: "Inventory expense",
  marketing: "Marketing",
  domain_hosting: "Domain & hosting",
  other_out: "Other payment",
  investment_in_business: "Investment in another business",
  transfer_to_business: "Transfer to another business",
  repayment_to_business: "Inter-business loan repayment",
};

export const INTER_BUSINESS_LABELS: Record<InterBusinessKind, string> = {
  investment: "Investment",
  transfer: "Transfer",
  loan_repayment: "Loan repayment",
};

/** The two sides of an inter-business transaction. */
export const LINKED_KINDS: Record<InterBusinessKind, { out: BusinessOutKind; in: BusinessInKind }> = {
  investment: { out: "investment_in_business", in: "investment_from_business" },
  transfer: { out: "transfer_to_business", in: "transfer_from_business" },
  loan_repayment: { out: "repayment_to_business", in: "repayment_from_business" },
};

export function directionOf(kind: BusinessTxnKind): BusinessDirection {
  return (BUSINESS_IN_KINDS as readonly string[]).includes(kind) || (LINKED_IN_KINDS as readonly string[]).includes(kind) ? "in" : "out";
}
export const isLinkedKind = (kind: BusinessTxnKind) =>
  (LINKED_IN_KINDS as readonly string[]).includes(kind) || (LINKED_OUT_KINDS as readonly string[]).includes(kind);
export function interKindOf(kind: BusinessTxnKind): InterBusinessKind | null {
  for (const k of INTER_BUSINESS_KINDS) if (LINKED_KINDS[k].in === kind || LINKED_KINDS[k].out === kind) return k;
  return null;
}

/** Money put into the business as capital (not revenue). */
export const INVESTMENT_IN_KINDS: BusinessTxnKind[] = ["owner_investment", "investment_from_business"];
/** Costs of running the business. */
export const EXPENSE_KINDS: BusinessTxnKind[] = ["expense", "product_purchase", "supplier_payment", "inventory", "marketing", "domain_hosting"];

/* ------------------------------------------------------------------ Ledger */

export interface BusinessTxnLike {
  id: string;
  kind: BusinessTxnKind;
  amount: number;
  date: string;
  /** Same-day order: creation time (ms or ISO). */
  createdAt: string | number | Date;
}

const seq = (t: BusinessTxnLike) => (t.createdAt instanceof Date ? t.createdAt.getTime() : typeof t.createdAt === "string" ? Date.parse(t.createdAt) : t.createdAt);

/** Ledger order: date, then the order they were recorded, then id. */
export function sortBusinessTxns<T extends BusinessTxnLike>(txns: T[]): T[] {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || seq(a) - seq(b) || a.id.localeCompare(b.id));
}

export const signedAmount = (t: Pick<BusinessTxnLike, "kind" | "amount">) => (directionOf(t.kind) === "in" ? t.amount : -t.amount);

/** Every transaction with the balance right after it (starting from the opening balance). */
export function withRunningBalance<T extends BusinessTxnLike>(opening: number, txns: T[]): (T & { balance: number })[] {
  let running = opening;
  return sortBusinessTxns(txns).map((t) => {
    running += signedAmount(t);
    return { ...t, balance: running };
  });
}

export interface BusinessTotals {
  openingBalance: number;
  moneyIn: number;
  moneyOut: number;
  /** Owner investment + investment from another business (capital, not revenue). */
  investmentsReceived: number;
  /** Revenue from operations. */
  income: number;
  /** Running costs (expense, purchases, suppliers, inventory, marketing, domain & hosting). */
  expenses: number;
  /** Money this business invested in another one. */
  investedInOthers: number;
  closingBalance: number;
  count: number;
}

/** Totals for a set of transactions starting from `opening`. Closing = opening + in − out. */
export function summarizeBusiness(opening: number, txns: Pick<BusinessTxnLike, "kind" | "amount">[]): BusinessTotals {
  let moneyIn = 0, moneyOut = 0, investmentsReceived = 0, income = 0, expenses = 0, investedInOthers = 0;
  for (const t of txns) {
    if (directionOf(t.kind) === "in") moneyIn += t.amount;
    else moneyOut += t.amount;
    if (INVESTMENT_IN_KINDS.includes(t.kind)) investmentsReceived += t.amount;
    if (t.kind === "income") income += t.amount;
    if (EXPENSE_KINDS.includes(t.kind)) expenses += t.amount;
    if (t.kind === "investment_in_business") investedInOthers += t.amount;
  }
  return { openingBalance: opening, moneyIn, moneyOut, investmentsReceived, income, expenses, investedInOthers, closingBalance: opening + moneyIn - moneyOut, count: txns.length };
}

/**
 * Figures for a date range: the balance before `from` (business opening balance + everything
 * earlier) is the period's opening balance; closing = that + money in − money out in the range.
 */
export function businessPeriod<T extends BusinessTxnLike>(opening: number, txns: T[], from: string | null, to: string | null) {
  const before = txns.filter((t) => from !== null && t.date < from);
  const inRange = txns.filter((t) => (from === null || t.date >= from) && (to === null || t.date <= to));
  const periodOpening = opening + before.reduce((s, t) => s + signedAmount(t), 0);
  const rows = withRunningBalance(opening, txns).filter((t) => (from === null || t.date >= from) && (to === null || t.date <= to));
  return { totals: summarizeBusiness(periodOpening, inRange), rows };
}
