import { z } from "zod";
import { parseTaka } from "./money";
import { isISODate, isMonth } from "./dates";
import {
  ACCOUNT_KINDS,
  BILL_TYPES,
  GOAL_KINDS,
  GOAL_STATUSES,
  INCOME_KINDS,
  PAYMENT_METHODS,
  PRIORITIES,
  TXN_STATUSES,
  TXN_TYPES,
  CATEGORY_NATURES,
} from "./constants";

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/** Positive money amount → poisha. Accepts "1,200.50", 1200, "১২০০". */
export const amountField = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = parseTaka(v);
  if (p === null || p <= 0) {
    ctx.addIssue({ code: "custom", message: "Enter an amount greater than 0" });
    return z.NEVER;
  }
  return p;
});

/** Zero-or-positive money amount → poisha. */
export const nonNegativeAmountField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return 0;
    const p = parseTaka(v);
    if (p === null || p < 0) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
      return z.NEVER;
    }
    return p;
  });

export const dateField = z.string().refine(isISODate, "Enter a valid date");
export const monthField = z.string().refine(isMonth, "Enter a valid month");
export const idField = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid reference");

const optionalId = z.preprocess(emptyToUndefined, idField.optional());
const optionalDate = z.preprocess(emptyToUndefined, dateField.optional());
const optionalMonth = z.preprocess(emptyToUndefined, monthField.optional());
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const breakdownItemSchema = z.object({
  name: z.string().trim().min(1, "Item name is required").max(120),
  amount: amountField,
  categoryId: optionalId,
  notes: optionalText(500),
});

export const billInfoSchema = z.object({
  billType: z.enum(BILL_TYPES),
  rechargeDate: optionalDate,
  coverageFrom: optionalDate,
  coverageTo: optionalDate,
  recurringBillId: optionalId,
});

export const txnInputSchema = z
  .object({
    type: z.enum(TXN_TYPES),
    title: z.string().trim().min(1, "Title is required").max(160),
    /** Ignored for breakdown expenses — the total is computed from items. */
    amount: z.preprocess(emptyToUndefined, amountField.optional()),
    date: dateField,
    attributionMonth: optionalMonth,
    status: z.enum(TXN_STATUSES).default("paid"),
    categoryId: optionalId,
    paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
    accountId: optionalId,
    toAccountId: optionalId,
    personId: optionalId,
    goalId: optionalId,
    notes: optionalText(2000),
    incomeKind: z.enum(INCOME_KINDS).optional(),
    incomeLabel: optionalText(80),
    items: z.array(breakdownItemSchema).max(100).default([]),
    bill: billInfoSchema.nullish(),
    fundingSourceId: optionalId,
  })
  .superRefine((v, ctx) => {
    if (v.items.length === 0 && v.amount === undefined) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount greater than 0" });
    }
    if (v.items.length > 0 && v.type !== "expense") {
      ctx.addIssue({ code: "custom", path: ["items"], message: "Only expenses can have a breakdown" });
    }
    if (v.type === "transfer") {
      if (!v.accountId || !v.toAccountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose both accounts" });
      } else if (v.accountId === v.toAccountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose two different accounts" });
      }
    }
    if ((v.type === "savings_deposit" || v.type === "savings_withdrawal") && !v.goalId) {
      ctx.addIssue({ code: "custom", path: ["goalId"], message: "Choose a savings goal" });
    }
    if (v.bill?.coverageFrom && v.bill.coverageTo && v.bill.coverageFrom > v.bill.coverageTo) {
      ctx.addIssue({ code: "custom", path: ["bill", "coverageTo"], message: "Coverage end is before its start" });
    }
  });

export type TxnInput = z.infer<typeof txnInputSchema>;
export type TxnInputRaw = z.input<typeof txnInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  parentId: optionalId,
  nature: z.enum(CATEGORY_NATURES).default("consumption"),
});

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  kind: z.enum(ACCOUNT_KINDS),
});

export const personInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  relation: optionalText(60),
  monthlyAllocation: nonNegativeAmountField,
  notes: optionalText(1000),
});

export const allocationInputSchema = z.object({
  personId: idField,
  month: monthField,
  amount: amountField,
  note: optionalText(500),
});

export const goalInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  kind: z.enum(GOAL_KINDS),
  targetAmount: amountField,
  targetDate: optionalDate,
  priority: z.enum(PRIORITIES),
  description: optionalText(1000),
  monthlyTarget: nonNegativeAmountField,
  status: z.enum(GOAL_STATUSES).default("active"),
  accountId: optionalId,
});

export const recurringBillInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80),
  billType: z.enum(BILL_TYPES),
  expectedAmount: nonNegativeAmountField,
  dueDay: z.coerce.number().int().min(1).max(31),
  active: z.boolean().default(true),
  notes: optionalText(500),
});

export const alertPrefsSchema = z.object({
  enabled: z.record(z.string(), z.boolean()),
  minBalance: nonNegativeAmountField,
  spendWarnPct: z.coerce.number().int().min(10).max(100),
  savingsReminderDay: z.coerce.number().int().min(0).max(28),
});
