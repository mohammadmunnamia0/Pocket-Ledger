import mongoose, { Schema, Types, type Model } from "mongoose";

/**
 * Data model overview
 *
 *  Transaction        — the single ledger. Salary/income, expenses (incl. utility bills
 *                       and breakdowns), account transfers and savings moves all live here.
 *  FundingAllocation  — which income (salary) funded which consumer, written by the FIFO engine.
 *  AllocationAudit    — history of allocation changes caused by edits to earlier records.
 *
 * Amounts are integer poisha. Dates are Dhaka calendar strings (see lib/dates.ts).
 * No collection stores a running/remaining balance — balances are always derived.
 */

import {
  TXN_TYPES,
  type TxnType,
  TXN_STATUSES,
  type TxnStatus,
  INCOME_KINDS,
  type IncomeKind,
  PAYMENT_METHODS,
  type PaymentMethod,
  ACCOUNT_KINDS,
  type AccountKind,
  BILL_TYPES,
  type BillType,
  CATEGORY_NATURES,
  type CategoryNature,
  GOAL_KINDS,
  type GoalKind,
  PRIORITIES,
  type Priority,
  GOAL_STATUSES,
  type GoalStatus,
  LOAN_DIRECTIONS,
  type LoanDirection,
  INVESTMENT_KINDS,
  type InvestmentKind,
} from "../constants";
export * from "../constants";

const money = { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: "Amount must be whole poisha" } };
const isoDate = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ };
const isoMonth = { type: String, match: /^\d{4}-\d{2}$/ };

function getModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T>) ?? mongoose.model<T>(name, schema);
}

/* ------------------------------------------------------------------ User */

export interface AlertPrefs {
  enabled: Record<string, boolean>;
  minBalance: number;
  spendWarnPct: number;
  savingsReminderDay: number;
}

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  ledgerVersion: number;
  prefs: {
    lastCategoryId?: Types.ObjectId | null;
    lastPaymentMethod?: PaymentMethod;
    lastAccountId?: Types.ObjectId | null;
    alerts: AlertPrefs;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    ledgerVersion: { type: Number, default: 0 },
    prefs: {
      lastCategoryId: { type: Schema.Types.ObjectId, default: null },
      lastPaymentMethod: { type: String, enum: PAYMENT_METHODS, default: "cash" },
      lastAccountId: { type: Schema.Types.ObjectId, default: null },
      alerts: {
        enabled: { type: Schema.Types.Mixed, default: {} },
        minBalance: { type: Number, default: 200000 },
        spendWarnPct: { type: Number, default: 75 },
        savingsReminderDay: { type: Number, default: 0 },
      },
    },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------ Account */

export interface AccountDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  kind: AccountKind;
  /** Why money is kept here (shown in the Remaining balance card). */
  note?: string;
  isDefault: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<AccountDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: ACCOUNT_KINDS, default: "cash" },
    note: { type: String, trim: true, maxlength: 200 },
    isDefault: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------ Category */

export interface CategoryDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  parentId: Types.ObjectId | null;
  nature: CategoryNature;
  /** Stable key for categories the app relies on (utility bills, allocations…). */
  systemKey?: string | null;
  color?: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<CategoryDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    parentId: { type: Schema.Types.ObjectId, default: null },
    nature: { type: String, enum: CATEGORY_NATURES, default: "consumption" },
    systemKey: { type: String, default: null },
    color: { type: String, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
CategorySchema.index({ userId: 1, parentId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

/* ------------------------------------------------------------------ Person & allocations */

export interface PersonDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  relation?: string;
  monthlyAllocation: number;
  notes?: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PersonSchema = new Schema<PersonDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    relation: { type: String, trim: true, maxlength: 60 },
    monthlyAllocation: { type: Number, default: 0 },
    notes: { type: String, maxlength: 1000 },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/** A budget commitment for a person and month. Not an expense — cash moves only via payments. */
export interface PersonAllocationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  personId: Types.ObjectId;
  month: string;
  amount: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PersonAllocationSchema = new Schema<PersonAllocationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    personId: { type: Schema.Types.ObjectId, required: true },
    month: { ...isoMonth, required: true },
    amount: money,
    note: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);
PersonAllocationSchema.index({ userId: 1, personId: 1, month: 1 }, { unique: true });

/* ------------------------------------------------------------------ Lending & borrowing */

/**
 * One loan with one person. The money itself lives in transactions linked by loanId:
 * the principal (lent → loan_out, borrowed → loan_in) and repayments (the opposite type),
 * so account balances and the ledger always agree with the loan.
 */
export interface LoanDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  direction: LoanDirection;
  person: string;
  date: string;
  dueDate?: string | null;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LoanSchema = new Schema<LoanDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    direction: { type: String, enum: LOAN_DIRECTIONS, required: true },
    person: { type: String, required: true, trim: true, maxlength: 80 },
    date: { ...isoDate, required: true },
    dueDate: { ...isoDate, default: null },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------ Investments */

/** An investment. Money in/out lives in transactions linked by investmentId (invest_out, invest_in, profit as income). */
export interface InvestmentDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  kind: InvestmentKind;
  date: string;
  /** What it is worth now, when known (poisha). */
  currentValue?: number | null;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvestmentSchema = new Schema<InvestmentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    kind: { type: String, enum: INVESTMENT_KINDS, default: "business" },
    date: { ...isoDate, required: true },
    currentValue: { type: Number, default: null, validate: { validator: (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0), message: "Invalid value" } },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------ Savings goals */

export interface SavingsGoalDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  kind: GoalKind;
  targetAmount: number;
  targetDate?: string | null;
  priority: Priority;
  description?: string;
  monthlyTarget: number;
  status: GoalStatus;
  /** Optional account that physically holds this fund (e.g. a separate savings account). */
  accountId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const SavingsGoalSchema = new Schema<SavingsGoalDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    kind: { type: String, enum: GOAL_KINDS, default: "other" },
    targetAmount: { ...money, min: 0 },
    targetDate: { ...isoDate, default: null },
    priority: { type: String, enum: PRIORITIES, default: "medium" },
    description: { type: String, maxlength: 1000 },
    monthlyTarget: { type: Number, default: 0 },
    status: { type: String, enum: GOAL_STATUSES, default: "active" },
    accountId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------ Transaction (ledger) */

export interface BreakdownItem {
  _id: Types.ObjectId;
  name: string;
  amount: number;
  categoryId?: Types.ObjectId | null;
  notes?: string;
}

export interface BillInfo {
  billType: BillType;
  rechargeDate?: string | null;
  coverageFrom?: string | null;
  coverageTo?: string | null;
  recurringBillId?: Types.ObjectId | null;
}

export interface TransactionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: TxnType;
  status: TxnStatus;
  title: string;
  /** Poisha, always > 0. Direction comes from `type`. For breakdowns, equals Σ items. */
  amount: number;
  /** Payment / receipt date (or due date while pending). */
  date: string;
  /** Month the money belongs to financially (e.g. November's bill paid on 28 Oct). */
  attributionMonth: string;
  categoryId?: Types.ObjectId | null;
  paymentMethod: PaymentMethod;
  accountId?: Types.ObjectId | null;
  toAccountId?: Types.ObjectId | null;
  personId?: Types.ObjectId | null;
  goalId?: Types.ObjectId | null;
  /** Lending & Borrowing: principal, repayments and interest of one loan. */
  loanId?: Types.ObjectId | null;
  /** Investments: money put in, capital returned and profit of one investment. */
  investmentId?: Types.ObjectId | null;
  notes?: string;
  income?: { kind: IncomeKind; label?: string } | null;
  items: BreakdownItem[];
  bill?: BillInfo | null;
  /** Manual FIFO override: draw from this income first. */
  fundingSourceId?: Types.ObjectId | null;
  importBatch?: string | null;
  /** Device-generated id of an offline-created record — prevents duplicates on re-sync. */
  clientRef?: string | null;
  /** Last offline sync operation applied to this record (makes update retries idempotent). */
  lastOpId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const BreakdownItemSchema = new Schema<BreakdownItem>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  amount: { ...money, min: 1 },
  categoryId: { type: Schema.Types.ObjectId, default: null },
  notes: { type: String, maxlength: 500 },
});

const TransactionSchema = new Schema<TransactionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: TXN_TYPES, required: true },
    status: { type: String, enum: TXN_STATUSES, default: "paid" },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    amount: { ...money, min: 1 },
    date: { ...isoDate, required: true },
    attributionMonth: { ...isoMonth, required: true },
    categoryId: { type: Schema.Types.ObjectId, default: null },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "cash" },
    accountId: { type: Schema.Types.ObjectId, default: null },
    toAccountId: { type: Schema.Types.ObjectId, default: null },
    personId: { type: Schema.Types.ObjectId, default: null },
    goalId: { type: Schema.Types.ObjectId, default: null },
    loanId: { type: Schema.Types.ObjectId, default: null },
    investmentId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, maxlength: 2000 },
    income: {
      type: new Schema({ kind: { type: String, enum: INCOME_KINDS, required: true }, label: String }, { _id: false }),
      default: null,
    },
    items: { type: [BreakdownItemSchema], default: [] },
    bill: {
      type: new Schema(
        {
          billType: { type: String, enum: BILL_TYPES, required: true },
          rechargeDate: { ...isoDate, default: null },
          coverageFrom: { ...isoDate, default: null },
          coverageTo: { ...isoDate, default: null },
          recurringBillId: { type: Schema.Types.ObjectId, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    fundingSourceId: { type: Schema.Types.ObjectId, default: null },
    importBatch: { type: String, default: null },
    clientRef: { type: String, default: null },
    lastOpId: { type: String, default: null },
  },
  { timestamps: true },
);
TransactionSchema.index({ userId: 1, date: 1, createdAt: 1 });
TransactionSchema.index({ userId: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: "string" } } });
TransactionSchema.index({ userId: 1, type: 1, status: 1, date: 1 });
TransactionSchema.index({ userId: 1, attributionMonth: 1 });
TransactionSchema.index({ userId: 1, categoryId: 1 });
TransactionSchema.index({ userId: 1, personId: 1 }, { partialFilterExpression: { personId: { $type: "objectId" } } });
TransactionSchema.index({ userId: 1, goalId: 1 }, { partialFilterExpression: { goalId: { $type: "objectId" } } });
TransactionSchema.index({ userId: 1, loanId: 1 }, { partialFilterExpression: { loanId: { $type: "objectId" } } });
TransactionSchema.index({ userId: 1, investmentId: 1 }, { partialFilterExpression: { investmentId: { $type: "objectId" } } });
TransactionSchema.index({ userId: 1, "bill.billType": 1, attributionMonth: 1 });

/* ------------------------------------------------------------------ Funding ledger */

export interface FundingAllocationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  consumerId: Types.ObjectId;
  sourceId: Types.ObjectId;
  amount: number;
  /** Denormalized dates so windows can be recomputed and reported on without joins. */
  consumerDate: string;
  sourceDate: string;
  createdAt: Date;
}

const FundingAllocationSchema = new Schema<FundingAllocationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    consumerId: { type: Schema.Types.ObjectId, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    amount: { ...money, min: 1 },
    consumerDate: { ...isoDate, required: true },
    sourceDate: { ...isoDate, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
FundingAllocationSchema.index({ userId: 1, consumerDate: 1 });
FundingAllocationSchema.index({ userId: 1, sourceId: 1 });
FundingAllocationSchema.index({ userId: 1, consumerId: 1 });

export interface AllocationAuditDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  reason: string;
  fromDate: string;
  changes: {
    consumerId: Types.ObjectId;
    before: { sourceId: Types.ObjectId; amount: number }[];
    after: { sourceId: Types.ObjectId; amount: number }[];
  }[];
  createdAt: Date;
}

const AllocationAuditSchema = new Schema<AllocationAuditDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true },
    fromDate: { type: String, required: true },
    changes: [
      {
        _id: false,
        consumerId: Schema.Types.ObjectId,
        before: [{ _id: false, sourceId: Schema.Types.ObjectId, amount: Number }],
        after: [{ _id: false, sourceId: Schema.Types.ObjectId, amount: Number }],
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
AllocationAuditSchema.index({ userId: 1, createdAt: -1 });

/* ------------------------------------------------------------------ Recurring bills */

export interface RecurringBillDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  billType: BillType;
  expectedAmount: number;
  dueDay: number;
  active: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringBillSchema = new Schema<RecurringBillDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    billType: { type: String, enum: BILL_TYPES, required: true },
    expectedAmount: { ...money, min: 0 },
    dueDay: { type: Number, min: 1, max: 31, default: 1 },
    active: { type: Boolean, default: true },
    notes: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------ Alerts */

export interface AlertStateDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  type: string;
  priority: Priority;
  title: string;
  message: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  readAt?: Date | null;
  dismissedAt?: Date | null;
}

const AlertStateSchema = new Schema<AlertStateDoc>({
  userId: { type: Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  type: { type: String, required: true },
  priority: { type: String, enum: PRIORITIES, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  firstSeenAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  readAt: { type: Date, default: null },
  dismissedAt: { type: Date, default: null },
});
AlertStateSchema.index({ userId: 1, key: 1 }, { unique: true });
AlertStateSchema.index({ userId: 1, lastSeenAt: -1 });

/* ------------------------------------------------------------------ Login throttling */

/**
 * Failed sign-in counter, keyed by email + client IP. Stored in the database (not process
 * memory) so the limit is consistent across serverless instances; expires automatically.
 */
export interface LoginAttemptDoc {
  _id: Types.ObjectId;
  key: string;
  failures: number;
  windowStart: Date;
  lockedUntil: Date | null;
  expiresAt: Date;
}

const LoginAttemptSchema = new Schema<LoginAttemptDoc>({
  key: { type: String, required: true, unique: true },
  failures: { type: Number, default: 0 },
  windowStart: { type: Date, required: true },
  lockedUntil: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

/* ------------------------------------------------------------------ Offline sync log */

/** Results of offline operations the server has applied — replaying an opId returns the same result. */
export interface SyncOpDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  opId: string;
  result: Record<string, unknown>;
  createdAt: Date;
}

const SyncOpSchema = new Schema<SyncOpDoc>({
  userId: { type: Schema.Types.ObjectId, required: true },
  opId: { type: String, required: true },
  result: { type: Schema.Types.Mixed, required: true },
  // Kept for 180 days — far longer than any device stays offline.
  createdAt: { type: Date, default: () => new Date(), index: { expireAfterSeconds: 180 * 24 * 3600 } },
});
SyncOpSchema.index({ userId: 1, opId: 1 }, { unique: true });

/* ------------------------------------------------------------------ Exports */

export const User = getModel<UserDoc>("User", UserSchema);
export const Account = getModel<AccountDoc>("Account", AccountSchema);
export const Category = getModel<CategoryDoc>("Category", CategorySchema);
export const Person = getModel<PersonDoc>("Person", PersonSchema);
export const PersonAllocation = getModel<PersonAllocationDoc>("PersonAllocation", PersonAllocationSchema);
export const SavingsGoal = getModel<SavingsGoalDoc>("SavingsGoal", SavingsGoalSchema);
export const Transaction = getModel<TransactionDoc>("Transaction", TransactionSchema);
export const FundingAllocation = getModel<FundingAllocationDoc>("FundingAllocation", FundingAllocationSchema);
export const AllocationAudit = getModel<AllocationAuditDoc>("AllocationAudit", AllocationAuditSchema);
export const RecurringBill = getModel<RecurringBillDoc>("RecurringBill", RecurringBillSchema);
export const AlertState = getModel<AlertStateDoc>("AlertState", AlertStateSchema);
export const LoginAttempt = getModel<LoginAttemptDoc>("LoginAttempt", LoginAttemptSchema);
export const SyncOp = getModel<SyncOpDoc>("SyncOp", SyncOpSchema);
export const Loan = getModel<LoanDoc>("Loan", LoanSchema);
export const Investment = getModel<InvestmentDoc>("Investment", InvestmentSchema);

export function oid(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

export function isObjectId(id: unknown): id is string {
  return typeof id === "string" && Types.ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id);
}
