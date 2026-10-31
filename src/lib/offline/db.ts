"use client";

/**
 * IndexedDB — the device's own copy of the ledger and its queue of changes.
 *   kv      : "snapshot" (last data from the server), "meta" (sync bookkeeping)
 *   outbox  : changes made on this device, kept until the server confirms each one
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Snapshot, SyncOperation } from "../sync/types";
import type { TxnDTO } from "../services/transactions";

export interface OutboxEntry {
  opId: string;
  /** Order the changes were made in — they are sent to the server in this order. */
  seq: number;
  /** Account the change belongs to; never sent under a different signed-in account. */
  userId: string;
  createdAt: string;
  op: SyncOperation;
  status: "pending" | "failed" | "conflict";
  error?: string;
  /** For conflicts: the newer version on the server. */
  server?: TxnDTO | null;
  attempts: number;
  /** Short description for the sync panel, e.g. "Chicken · ৳1,200". */
  label: string;
}

export interface SyncMeta {
  lastSyncAt: string | null;
  lastError: string | null;
}

interface PocketLedgerDB extends DBSchema {
  kv: { key: string; value: Snapshot | SyncMeta };
  outbox: { key: string; value: OutboxEntry; indexes: { seq: number } };
}

let dbPromise: Promise<IDBPDatabase<PocketLedgerDB>> | null = null;

function db() {
  dbPromise ??= openDB<PocketLedgerDB>("pocketledger", 1, {
    upgrade(d) {
      d.createObjectStore("kv");
      d.createObjectStore("outbox", { keyPath: "opId" }).createIndex("seq", "seq");
    },
  });
  return dbPromise;
}

export async function readSnapshot(): Promise<Snapshot | null> {
  return ((await (await db()).get("kv", "snapshot")) as Snapshot | undefined) ?? null;
}
export async function writeSnapshot(s: Snapshot) {
  await (await db()).put("kv", s, "snapshot");
}
export async function readMeta(): Promise<SyncMeta> {
  return ((await (await db()).get("kv", "meta")) as SyncMeta | undefined) ?? { lastSyncAt: null, lastError: null };
}
export async function writeMeta(m: SyncMeta) {
  await (await db()).put("kv", m, "meta");
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  return (await db()).getAllFromIndex("outbox", "seq");
}
export async function putEntry(e: OutboxEntry) {
  await (await db()).put("outbox", e);
}
export async function deleteEntry(opId: string) {
  await (await db()).delete("outbox", opId);
}

/** Remove everything stored on this device (used on sign-out). */
export async function clearDevice() {
  const d = await db();
  await Promise.all([d.clear("kv"), d.clear("outbox")]);
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* best effort */
  }
}
