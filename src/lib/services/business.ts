/**
 * Business accounting service — one implementation for every business. Every query and
 * every change is scoped to the user AND the business's permanent id, so one business's
 * records can never be read into, or written to, another. Inter-business transactions are
 * the only records touching two businesses: both sides are written in one database
 * transaction with a shared reference, and edited or deleted together.
 */
import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession, type Types } from "mongoose";
import { connectDB } from "../db/connect";
import { Business, BusinessTxn, oid, type BusinessDoc, type BusinessTxnDoc } from "../db/models";
import { AppError, NotFoundError } from "../errors";
import { formatDate } from "../dates";
import {
  INTER_BUSINESS_LABELS,
  LINKED_KINDS,
  businessPeriod,
  interKindOf,
  isLinkedKind,
  summarizeBusiness,
  withRunningBalance,
  type BusinessTotals,
  type BusinessTxnKind,
  type InterBusinessKind,
} from "../business/model";
import { BUSINESSES, businessPreset, type BusinessKey } from "../business/registry";
import type { PeriodFilter } from "../business/period";
import {
  businessSetupSchema,
  businessTxnSchema,
  interBusinessSchema,
  type BusinessSetupRaw,
  type BusinessTxnRaw,
  type InterBusinessRaw,
} from "../validation";

export interface BusinessInfo {
  id: string;
  key: string;
  name: string;
  type: string;
  openingBalance: number;
  openingDate: string;
}

export interface BusinessTxnView {
  id: string;
  kind: BusinessTxnKind;
  title: string;
  amount: number;
  date: string;
  party: string | null;
  note: string | null;
  linkRef: string | null;
  interKind: InterBusinessKind | null;
  other: { id: string; key: string; name: string } | null;
  createdAt: string;
  balance: number;
}

export interface BusinessCard {
  key: BusinessKey;
  name: string;
  type: string;
  available: boolean;
  business: BusinessInfo | null;
  balance: number | null;
}

const info = (b: BusinessDoc): BusinessInfo => ({
  id: b._id.toString(),
  key: b.key,
  name: b.name,
  type: b.type,
  openingBalance: b.openingBalance,
  openingDate: b.openingDate,
});

async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  await connectDB();
  return mongoose.connection.transaction(fn);
}

/* ------------------------------------------------------------------ reading */

export async function getBusiness(userId: string, key: string): Promise<BusinessInfo | null> {
  await connectDB();
  const b = await Business.findOne({ userId: oid(userId), key }).lean();
  return b ? info(b) : null;
}

async function requireBusiness(userId: string, key: string, session?: ClientSession) {
  const b = await Business.findOne({ userId: oid(userId), key }, null, { session }).lean();
  if (!b) throw new NotFoundError("Business");
  return b;
}

/** Balance = opening + money in − money out, from this business's own records only. */
async function balanceOf(userId: string, b: BusinessDoc) {
  const rows = await BusinessTxn.find({ userId: oid(userId), businessId: b._id }, { kind: 1, amount: 1 }).lean();
  return summarizeBusiness(b.openingBalance, rows.map((r) => ({ kind: r.kind as BusinessTxnKind, amount: r.amount }))).closingBalance;
}

/** The business cards for the landing page. */
export async function listBusinessCards(userId: string): Promise<BusinessCard[]> {
  await connectDB();
  const docs = await Business.find({ userId: oid(userId) }).lean();
  return Promise.all(
    BUSINESSES.map(async (p) => {
      const doc = docs.find((d) => d.key === p.key);
      return {
        key: p.key,
        name: doc?.name ?? p.name,
        type: doc?.type ?? p.type,
        available: p.available,
        business: doc ? info(doc) : null,
        balance: doc ? await balanceOf(userId, doc) : null,
      };
    }),
  );
}

/** The other businesses that are set up (for inter-business transactions). */
export async function otherBusinesses(userId: string, key: string): Promise<BusinessInfo[]> {
  await connectDB();
  const docs = await Business.find({ userId: oid(userId), key: { $ne: key } }).lean();
  return docs.map(info).sort((a, b) => a.name.localeCompare(b.name));
}

export interface BusinessLedger {
  business: BusinessInfo;
  /** All-time figures (the dashboard). */
  overall: BusinessTotals;
  /** Figures for the chosen period (equal to overall when no filter). */
  period: BusinessTotals;
  /** Transactions in the period with the true running balance after each, oldest first. */
  rows: BusinessTxnView[];
  recent: BusinessTxnView[];
}

export async function getBusinessLedger(userId: string, key: string, filter: PeriodFilter): Promise<BusinessLedger | null> {
  await connectDB();
  const uid = oid(userId);
  const b = await Business.findOne({ userId: uid, key }).lean();
  if (!b) return null;
  const docs = await BusinessTxn.find({ userId: uid, businessId: b._id }).lean();
  const otherIds = [...new Set(docs.map((d) => d.otherBusinessId?.toString()).filter(Boolean))] as string[];
  const others = otherIds.length ? await Business.find({ userId: uid, _id: { $in: otherIds.map(oid) } }).lean() : [];
  const otherOf = (id: Types.ObjectId | null | undefined) => {
    const o = id ? others.find((x) => x._id.toString() === id.toString()) : undefined;
    return o ? { id: o._id.toString(), key: o.key, name: o.name } : null;
  };
  const txns = docs.map((d) => ({
    id: d._id.toString(),
    kind: d.kind as BusinessTxnKind,
    title: d.title,
    amount: d.amount,
    date: d.date,
    party: d.party ?? null,
    note: d.note ?? null,
    linkRef: d.linkRef ?? null,
    interKind: interKindOf(d.kind as BusinessTxnKind),
    other: otherOf(d.otherBusinessId),
    createdAt: d.createdAt.toISOString(),
  }));
  const all = withRunningBalance(b.openingBalance, txns);
  const p = businessPeriod(b.openingBalance, txns, filter.from, filter.to);
  return {
    business: info(b),
    overall: summarizeBusiness(b.openingBalance, txns),
    period: p.totals,
    rows: p.rows,
    recent: all.slice(-5).reverse(),
  };
}

/* ------------------------------------------------------------------ set-up */

/** Set up a business (identity + opening balance), or change them later. */
export async function setupBusiness(userId: string, key: string, raw: BusinessSetupRaw): Promise<string> {
  const preset = businessPreset(key);
  if (!preset || !preset.available) throw new AppError("This business isn't available yet.");
  const input = businessSetupSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  const existing = await Business.findOne({ userId: uid, key }).lean();
  if (existing) {
    const first = await BusinessTxn.findOne({ userId: uid, businessId: existing._id }, { date: 1 }).sort({ date: 1 }).lean();
    if (first && first.date < input.openingDate) {
      throw new AppError(`The opening date must be on or before the first transaction (${formatDate(first.date)}).`);
    }
    await Business.updateOne({ _id: existing._id }, { $set: input });
    return existing._id.toString();
  }
  try {
    return (await Business.create({ userId: uid, key, ...input }))._id.toString();
  } catch (err) {
    // Set up twice at the same moment: the unique key keeps one.
    if ((err as { code?: number }).code === 11000) return (await Business.findOne({ userId: uid, key }).lean())!._id.toString();
    throw err;
  }
}

/* ------------------------------------------------------------------ ordinary transactions */

function assertOnOrAfterOpening(b: BusinessDoc, date: string) {
  if (date < b.openingDate) {
    throw new AppError(`${b.name}'s records start on ${formatDate(b.openingDate)} (its opening balance). Choose that date or later.`);
  }
}

/** Add or edit a money-in / money-out transaction of this business only. */
export async function saveBusinessTxn(userId: string, key: string, raw: BusinessTxnRaw, id?: string): Promise<string> {
  const input = businessTxnSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  const b = await requireBusiness(userId, key);
  const doc = { kind: input.kind, title: input.title, amount: input.amount, date: input.date, party: input.party ?? null, note: input.note ?? null };
  if (!id) {
    assertOnOrAfterOpening(b, input.date);
    return (await BusinessTxn.create({ userId: uid, businessId: b._id, ...doc }))._id.toString();
  }

  // Only a transaction of THIS business can be changed from its page.
  const existing = await BusinessTxn.findOne({ _id: oid(id), userId: uid, businessId: b._id }).lean();
  if (!existing) throw new NotFoundError("Transaction");
  if (existing.linkRef) throw new AppError("This is an inter-business transaction — edit it as one, so both businesses stay in step.");
  assertOnOrAfterOpening(b, input.date);
  await BusinessTxn.updateOne({ _id: existing._id, userId: uid, businessId: b._id }, { $set: doc });
  return id;
}

/* ------------------------------------------------------------------ inter-business transactions */

function sideTitles(kind: InterBusinessKind, payer: BusinessDoc, receiver: BusinessDoc, title?: string) {
  const what = INTER_BUSINESS_LABELS[kind];
  return {
    out: title ?? `${what} to ${receiver.name}`,
    in: title ?? `${what} from ${payer.name}`,
  };
}

/**
 * Create (or edit) an inter-business transaction: money leaves the paying business and
 * arrives in the receiving one. Both records are written together in one database
 * transaction and share `linkRef`, so one side can never exist without the other.
 */
export async function saveInterBusiness(userId: string, key: string, raw: InterBusinessRaw, linkRef?: string): Promise<string> {
  const input = interBusinessSchema.parse(raw);
  const uid = oid(userId);
  return inTransaction(async (session) => {
    const self = await requireBusiness(userId, key, session);
    const other = await Business.findOne({ _id: oid(input.otherBusinessId), userId: uid }, null, { session }).lean();
    if (!other) throw new NotFoundError("Other business");
    if (other._id.equals(self._id)) throw new AppError("Choose a different business.");
    const payer = input.direction === "out" ? self : other;
    const receiver = input.direction === "out" ? other : self;
    assertOnOrAfterOpening(payer, input.date);
    assertOnOrAfterOpening(receiver, input.date);
    const kinds = LINKED_KINDS[input.interKind];
    const titles = sideTitles(input.interKind, payer, receiver, input.title);
    const common = { userId: uid, amount: input.amount, date: input.date, note: input.note ?? null, party: null };
    const outSide = { ...common, businessId: payer._id, otherBusinessId: receiver._id, kind: kinds.out, title: titles.out };
    const inSide = { ...common, businessId: receiver._id, otherBusinessId: payer._id, kind: kinds.in, title: titles.in };

    if (!linkRef) {
      const ref = input.ref ?? randomUUID();
      // A retried save with the same ref returns the pair already saved — never a duplicate.
      if (await BusinessTxn.exists({ userId: uid, linkRef: ref }).session(session)) return ref;
      await BusinessTxn.create([{ ...outSide, linkRef: ref }, { ...inSide, linkRef: ref }], { session, ordered: true });
      return ref;
    }

    const sides = await BusinessTxn.find({ userId: uid, linkRef }, null, { session }).lean();
    if (sides.length !== 2 || !sides.some((s) => s.businessId.equals(self._id))) throw new NotFoundError("Inter-business transaction");
    // Edit both sides in place (createdAt — the same-day order — is kept). The record in this
    // business becomes this business's side; the other record becomes the other business's side.
    const mine = input.direction === "out" ? outSide : inSide;
    const theirs = input.direction === "out" ? inSide : outSide;
    for (const s of sides) {
      await BusinessTxn.updateOne({ _id: s._id, userId: uid }, { $set: s.businessId.equals(self._id) ? mine : theirs }, { session });
    }
    return linkRef;
  });
}

/** Delete a transaction; an inter-business one is removed from both businesses together. */
export async function deleteBusinessTxn(userId: string, key: string, id: string): Promise<void> {
  const uid = oid(userId);
  await inTransaction(async (session) => {
    const b = await requireBusiness(userId, key, session);
    const t = await BusinessTxn.findOne({ _id: oid(id), userId: uid, businessId: b._id }, null, { session }).lean();
    if (!t) throw new NotFoundError("Transaction");
    if (t.linkRef) await BusinessTxn.deleteMany({ userId: uid, linkRef: t.linkRef }, { session });
    else await BusinessTxn.deleteOne({ _id: t._id, userId: uid, businessId: b._id }, { session });
  });
}

export const isInterBusiness = (t: Pick<BusinessTxnDoc, "kind">) => isLinkedKind(t.kind as BusinessTxnKind);
