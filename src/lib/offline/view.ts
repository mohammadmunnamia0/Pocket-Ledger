/**
 * The device's view of the ledger: the last server snapshot with this device's queued
 * changes applied — exactly as the server will store them (shared deriveTxn), and checked
 * with the same FIFO funding rule before a change is accepted.
 */
import { deriveTxn } from "../ledger/derive";
import { computeAllocations, computeDashboardFigures } from "../ledger/model";
import { txnInputSchema, type TxnInputRaw } from "../validation";
import { formatDate } from "../dates";
import { formatTaka } from "../money";
import type { Snapshot } from "../sync/types";
import type { TxnDTO } from "../services/transactions";
import type { OutboxEntry } from "./db";

export type LocalTxn = TxnDTO & {
  /** Set while the change is waiting for the server. */
  syncState?: "new" | "edited";
  syncStatus?: OutboxEntry["status"];
};

export const LOCAL_PREFIX = "local:";
export const isLocalId = (id: string) => id.startsWith(LOCAL_PREFIX);

/** Build the stored shape of a transaction from form input (same rules as the server). */
export function toLocalTxn(raw: TxnInputRaw, snap: Snapshot, id: string, createdAt: string, updatedAt: string): LocalTxn {
  const input = txnInputSchema.parse(raw);
  const { lookups } = snap;
  const d = deriveTxn(input, {
    othersCategoryId: lookups.categories.find((c) => c.systemKey === "others")?.id ?? null,
    defaultAccountId: lookups.accounts.find((a) => a.isDefault)?.id ?? null,
  });
  const cat = (cid: string | null) => (cid ? (lookups.categories.find((c) => c.id === cid)?.label ?? null) : null);
  const acc = (aid: string | null) => (aid ? (lookups.accounts.find((a) => a.id === aid)?.name ?? null) : null);
  return {
    id,
    type: d.type,
    status: d.status,
    title: d.title,
    amount: d.amount,
    date: d.date,
    attributionMonth: d.attributionMonth,
    categoryId: d.categoryId,
    categoryLabel: cat(d.categoryId),
    paymentMethod: d.paymentMethod,
    accountId: d.accountId,
    accountName: acc(d.accountId),
    toAccountId: d.toAccountId,
    toAccountName: acc(d.toAccountId),
    personId: d.personId,
    personName: d.personId ? (lookups.persons.find((p) => p.id === d.personId)?.name ?? null) : null,
    goalId: d.goalId,
    goalName: d.goalId ? (lookups.goals.find((g) => g.id === d.goalId)?.name ?? null) : null,
    notes: d.notes ?? null,
    incomeKind: d.income?.kind ?? null,
    incomeLabel: d.income?.label ?? null,
    items: d.items.map((i, n) => ({ id: `${id}-item-${n}`, name: i.name, amount: i.amount, categoryId: i.categoryId, categoryLabel: cat(i.categoryId), notes: i.notes ?? null })),
    bill: d.bill,
    fundingSourceId: d.fundingSourceId,
    createdAt,
    updatedAt,
  };
}

/** Snapshot + queued changes for this account, in the order they were made. */
export function buildLocalTxns(snap: Snapshot, outbox: OutboxEntry[]): LocalTxn[] {
  const byId = new Map<string, LocalTxn>(snap.transactions.map((t) => [t.id, t]));
  for (const e of outbox) {
    if (e.userId !== snap.user.id) continue;
    const { op } = e;
    try {
      if (op.kind === "create") {
        const id = LOCAL_PREFIX + op.clientRef;
        byId.set(id, { ...toLocalTxn(op.payload, snap, id, e.createdAt, e.createdAt), syncState: "new", syncStatus: e.status });
      } else if (op.kind === "update") {
        const base = byId.get(op.txnId);
        if (!base) continue;
        byId.set(op.txnId, { ...toLocalTxn(op.payload, snap, op.txnId, base.createdAt, base.updatedAt), syncState: "edited", syncStatus: e.status });
      } else {
        byId.delete(op.txnId);
      }
    } catch {
      /* an invalid queued payload is surfaced in the sync panel, not applied */
    }
  }
  return [...byId.values()];
}

export function localFigures(snap: Snapshot, txns: LocalTxn[], today: string) {
  return computeDashboardFigures({
    txns,
    lookups: snap.lookups,
    persons: snap.lookups.persons,
    personAllocations: snap.personAllocations,
    today,
  });
}

/**
 * Would this set of transactions leave any paid expense unfunded? The same FIFO rule the
 * server enforces — checked on the device so an impossible change is refused immediately.
 */
export function fundingProblem(txns: LocalTxn[], changedId: string): string | null {
  const { shortfalls } = computeAllocations(txns);
  if (shortfalls.length === 0) return null;
  const s = shortfalls[0];
  const t = txns.find((x) => x.id === s.consumerId);
  const what = s.consumerId === changedId ? "This entry" : `“${t?.title ?? "An expense"}” on ${formatDate(s.date)}`;
  return (
    `Insufficient funds: ${what} needs ${formatTaka(s.required)} but only ${formatTaka(s.funded)} was available ` +
    `from salaries received by ${formatDate(s.date)}. Record the income first or reduce the amount.`
  );
}

/** A stored transaction back as form input (for offline edits such as "mark paid"). */
export function toInput(t: TxnDTO, patch: Partial<TxnInputRaw> = {}): TxnInputRaw {
  const money = (p: number) => (p / 100).toFixed(2).replace(/\.00$/, "");
  return {
    type: t.type,
    title: t.title,
    amount: t.items.length ? undefined : money(t.amount),
    date: t.date,
    attributionMonth: t.attributionMonth,
    status: t.status,
    categoryId: t.categoryId ?? undefined,
    paymentMethod: t.paymentMethod,
    accountId: t.accountId ?? undefined,
    toAccountId: t.toAccountId ?? undefined,
    personId: t.personId ?? undefined,
    goalId: t.goalId ?? undefined,
    notes: t.notes ?? undefined,
    incomeKind: t.incomeKind ?? undefined,
    incomeLabel: t.incomeLabel ?? undefined,
    items: t.items.map((i) => ({ name: i.name, amount: money(i.amount), categoryId: i.categoryId ?? undefined, notes: i.notes ?? undefined })),
    bill: t.bill
      ? {
          billType: t.bill.billType,
          rechargeDate: t.bill.rechargeDate ?? undefined,
          coverageFrom: t.bill.coverageFrom ?? undefined,
          coverageTo: t.bill.coverageTo ?? undefined,
          recurringBillId: t.bill.recurringBillId ?? undefined,
        }
      : null,
    fundingSourceId: t.fundingSourceId ?? undefined,
    ...patch,
  };
}
