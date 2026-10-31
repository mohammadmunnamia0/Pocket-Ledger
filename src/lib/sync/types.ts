/**
 * Offline sync protocol — shared by the server (/api/sync/*) and the device (IndexedDB queue).
 * No server-only imports here.
 */
import type { TxnInputRaw } from "../validation";
import type { CategoryOption } from "../services/lookups";
import type { TxnDTO } from "../services/transactions";
import type { AccountKind, GoalKind, GoalStatus } from "../constants";

/** Everything the device needs to run the app offline. */
export interface Snapshot {
  /** Content hash — unchanged data is not re-downloaded. */
  version: string;
  serverTime: string;
  user: { id: string; name: string; email: string };
  lookups: {
    categories: CategoryOption[];
    accounts: { id: string; name: string; kind: AccountKind; isDefault: boolean; archived: boolean }[];
    persons: { id: string; name: string; relation: string | null; archived: boolean }[];
    goals: { id: string; name: string; kind: GoalKind; status: GoalStatus; accountId: string | null }[];
  };
  personAllocations: { id: string; personId: string; month: string; amount: number; note: string | null }[];
  goalTargets: { id: string; targetAmount: number; monthlyTarget: number }[];
  transactions: TxnDTO[];
}

/** One queued change. Kept on the device until the server confirms it. */
export type SyncOperation =
  | { opId: string; kind: "create"; clientRef: string; payload: TxnInputRaw }
  | { opId: string; kind: "update"; txnId: string; baseUpdatedAt: string; payload: TxnInputRaw; force?: boolean }
  | { opId: string; kind: "delete"; txnId: string; baseUpdatedAt: string; force?: boolean };

export type SyncResult =
  /** updatedAt: the record's new version stamp (null when deleted) — later queued edits use it as their base. */
  | { opId: string; status: "applied"; txnId: string | null; updatedAt: string | null }
  /** The record changed (or was deleted) on another device since this edit was made. */
  | { opId: string; status: "conflict"; message: string; server: TxnDTO | null }
  /** The server refused the change (e.g. not enough funds) — nothing was saved. */
  | { opId: string; status: "rejected"; error: string };
