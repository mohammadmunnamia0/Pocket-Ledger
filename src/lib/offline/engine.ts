"use client";

/**
 * Offline sync engine (one per browser tab, coordinated across tabs).
 *
 *  - IndexedDB is the device's store: a snapshot of server data + an outbox of changes.
 *  - Changes are queued first and removed only after the server confirms them.
 *  - Sync pushes the outbox strictly in order (one change per request), then pulls the
 *    latest snapshot. A rejected or conflicting change stops the queue until resolved,
 *    so changes are never applied out of order or silently dropped.
 *  - A Web Lock serialises queue edits and syncing across tabs.
 */
import {
  clearDevice,
  deleteEntry,
  putEntry,
  readMeta,
  readOutbox,
  readSnapshot,
  requestPersistence,
  writeMeta,
  writeSnapshot,
  type OutboxEntry,
} from "./db";
import { LOCAL_PREFIX, buildLocalTxns, fundingProblem, isLocalId, toLocalTxn, type LocalTxn } from "./view";
import type { Snapshot, SyncOperation, SyncResult } from "../sync/types";
import type { TxnInputRaw } from "../validation";

export interface SyncState {
  ready: boolean;
  online: boolean;
  /** Online but the last request could not reach the server. */
  unreachable: boolean;
  syncing: boolean;
  pending: number;
  /** Changes that need a decision (rejected or conflicting). */
  attention: number;
  lastSyncAt: string | null;
  lastError: string | null;
  signedOut: boolean;
  hasSnapshot: boolean;
  userId: string | null;
}

let state: SyncState = {
  ready: false,
  online: true,
  unreachable: false,
  syncing: false,
  pending: 0,
  attention: 0,
  lastSyncAt: null,
  lastError: null,
  signedOut: false,
  hasSnapshot: false,
  userId: null,
};
let snapshot: Snapshot | null = null;
let outbox: OutboxEntry[] = [];
let dataVersion = 0;

const stateListeners = new Set<() => void>();
const dataListeners = new Set<() => void>();
const serverChangeListeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

/* ------------------------------------------------------------------ subscriptions */

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l());
}
export const getSyncState = () => state;
export function subscribeSync(fn: () => void) {
  stateListeners.add(fn);
  return () => {
    stateListeners.delete(fn);
  };
}

export interface LocalData {
  snapshot: Snapshot | null;
  outbox: OutboxEntry[];
  version: number;
}
let localData: LocalData = { snapshot: null, outbox: [], version: 0 };
export const getLocalData = () => localData;
export function subscribeLocalData(fn: () => void) {
  dataListeners.add(fn);
  return () => {
    dataListeners.delete(fn);
  };
}
/** Called after this device's changes reach the server (the online app refreshes its view). */
export function onServerChanged(fn: () => void) {
  serverChangeListeners.add(fn);
  return () => {
    serverChangeListeners.delete(fn);
  };
}

function mine(entries: OutboxEntry[]) {
  return state.userId ? entries.filter((e) => e.userId === state.userId) : entries;
}

function publish() {
  dataVersion++;
  localData = { snapshot, outbox, version: dataVersion };
  const own = mine(outbox);
  setState({
    pending: own.length,
    attention: own.filter((e) => e.status !== "pending").length,
    hasSnapshot: !!snapshot,
  });
  dataListeners.forEach((l) => l());
}

async function reload() {
  [snapshot, outbox] = await Promise.all([readSnapshot(), readOutbox()]);
  if (snapshot && state.userId && snapshot.user.id !== state.userId) snapshot = null; // another account's data
  publish();
}

/* ------------------------------------------------------------------ locking */

let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("pocketledger-ledger", fn) as Promise<T>;
  }
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/* ------------------------------------------------------------------ start */

/**
 * Start the engine. `userId` comes from the signed-in online app; the offline app starts
 * without it and uses the account in the stored snapshot.
 */
export async function startSync(userId?: string | null) {
  if (userId) setState({ userId });
  if (!started) {
    started = true;
    setState({ online: navigator.onLine });
    window.addEventListener("online", () => {
      setState({ online: true });
      void syncNow();
    });
    window.addEventListener("offline", () => setState({ online: false }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void syncNow();
    });
    setInterval(() => {
      if (state.pending > 0) void syncNow({ pull: false });
    }, 60_000);
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("pocketledger-sync");
      channel.onmessage = () => void reload();
    }
    void requestPersistence();
  }
  const meta = await readMeta();
  setState({ lastSyncAt: meta.lastSyncAt, lastError: meta.lastError });
  await reload();
  if (!state.userId && snapshot) setState({ userId: snapshot.user.id });
  setState({ ready: true });
  void syncNow();
}

function changed() {
  channel?.postMessage("changed");
}

/* ------------------------------------------------------------------ queueing */

const uid = () => crypto.randomUUID();
let seqCounter = 0;
const nextSeq = () => Date.now() * 1000 + (seqCounter++ % 1000);

export type QueueResult = { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function validate(raw: TxnInputRaw, snap: Snapshot, id: string): { ok: true; txn: LocalTxn } | { ok: false; error: string; fieldErrors?: Record<string, string> } {
  try {
    const now = new Date().toISOString();
    return { ok: true, txn: toLocalTxn(raw, snap, id, now, now) };
  } catch (err) {
    const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    if (!issues) return { ok: false, error: "Invalid entry" };
    const fieldErrors: Record<string, string> = {};
    for (const i of issues) fieldErrors[i.path.map(String).join(".") || "form"] ??= i.message;
    return { ok: false, error: issues[0]?.message ?? "Invalid entry", fieldErrors };
  }
}

/** Apply the change to the local view and run the same FIFO funding check as the server. */
function checkFunding(snap: Snapshot, entries: OutboxEntry[], extra: OutboxEntry, changedId: string): string | null {
  return fundingProblem(buildLocalTxns(snap, [...entries, extra]), changedId);
}

const labelFor = (raw: TxnInputRaw) => `${raw.title || "Entry"}${raw.amount ? ` · ৳${raw.amount}` : ""}`;

/** Queue a new transaction. */
export function queueCreate(raw: TxnInputRaw): Promise<QueueResult> {
  return withLock(async () => {
    await reload();
    if (!snapshot) return { ok: false, error: "This device has no saved copy yet — open the app once while online." };
    const clientRef = uid();
    const id = LOCAL_PREFIX + clientRef;
    const v = validate(raw, snapshot, id);
    if (!v.ok) return v;
    const entry: OutboxEntry = {
      opId: uid(),
      seq: nextSeq(),
      userId: snapshot.user.id,
      createdAt: new Date().toISOString(),
      op: { opId: "", kind: "create", clientRef, payload: raw },
      status: "pending",
      attempts: 0,
      label: `Add ${labelFor(raw)}`,
    };
    entry.op.opId = entry.opId;
    const problem = checkFunding(snapshot, mine(outbox), entry, id);
    if (problem) return { ok: false, error: problem };
    await putEntry(entry);
    await afterQueue();
    return { ok: true, id };
  });
}

/** Queue an edit of an existing (or still-unsynced) transaction. */
export function queueUpdate(target: { id: string; updatedAt: string }, raw: TxnInputRaw): Promise<QueueResult> {
  return withLock(async () => {
    await reload();
    if (!snapshot) return { ok: false, error: "This device has no saved copy yet — open the app once while online." };
    const v = validate(raw, snapshot, target.id);
    if (!v.ok) return v;
    const own = mine(outbox);

    // Never sent yet → fold the edit into the queued change instead of adding another.
    const unsentCreate = isLocalId(target.id)
      ? own.find((e) => e.op.kind === "create" && LOCAL_PREFIX + e.op.clientRef === target.id && e.attempts === 0)
      : undefined;
    const unsentUpdate = own.find((e) => e.op.kind === "update" && e.op.txnId === target.id && e.attempts === 0);
    const existing = unsentCreate ?? unsentUpdate;
    let entry: OutboxEntry;
    if (existing) {
      entry = { ...existing, op: { ...existing.op, payload: raw } as SyncOperation, status: "pending", error: undefined, label: `${existing.op.kind === "create" ? "Add" : "Edit"} ${labelFor(raw)}` };
    } else {
      const opId = uid();
      entry = {
        opId,
        seq: nextSeq(),
        userId: snapshot.user.id,
        createdAt: new Date().toISOString(),
        op: { opId, kind: "update", txnId: target.id, baseUpdatedAt: target.updatedAt, payload: raw },
        status: "pending",
        attempts: 0,
        label: `Edit ${labelFor(raw)}`,
      };
    }
    const others = own.filter((e) => e.opId !== entry.opId);
    const problem = checkFunding(snapshot, others, entry, target.id);
    if (problem) return { ok: false, error: problem };
    await putEntry(entry);
    await afterQueue();
    return { ok: true, id: target.id };
  });
}

/** Queue a delete. */
export function queueDelete(target: { id: string; updatedAt: string; title: string }): Promise<QueueResult> {
  return withLock(async () => {
    await reload();
    if (!snapshot) return { ok: false, error: "This device has no saved copy yet." };
    const own = mine(outbox);
    const refersTo = (e: OutboxEntry) =>
      (e.op.kind === "create" && LOCAL_PREFIX + e.op.clientRef === target.id) || (e.op.kind !== "create" && e.op.txnId === target.id);
    const related = own.filter(refersTo);
    const create = related.find((e) => e.op.kind === "create");

    // Created on this device and never sent: simply forget it.
    if (create && create.attempts === 0) {
      for (const e of related) await deleteEntry(e.opId);
      await afterQueue();
      return { ok: true, id: target.id };
    }
    // Drop edits that were never sent; the delete replaces them.
    for (const e of related) if (e.op.kind === "update" && e.attempts === 0) await deleteEntry(e.opId);
    const firstUnsentBase = related.find((e) => e.op.kind === "update" && e.attempts === 0);
    const opId = uid();
    const base = firstUnsentBase && firstUnsentBase.op.kind === "update" ? firstUnsentBase.op.baseUpdatedAt : target.updatedAt;
    const entry: OutboxEntry = {
      opId,
      seq: nextSeq(),
      userId: snapshot.user.id,
      createdAt: new Date().toISOString(),
      op: { opId, kind: "delete", txnId: target.id, baseUpdatedAt: base },
      status: "pending",
      attempts: 0,
      label: `Delete ${target.title}`,
    };
    const remaining = (await readOutbox()).filter((e) => e.userId === snapshot!.user.id);
    const problem = checkFunding(snapshot, remaining, entry, target.id);
    if (problem) return { ok: false, error: problem };
    await putEntry(entry);
    await afterQueue();
    return { ok: true, id: target.id };
  });
}

async function afterQueue() {
  await reload();
  changed();
  if (navigator.onLine) setTimeout(() => void syncNow({ pull: true }), 0);
}

/* ------------------------------------------------------------------ resolving problems */

export function retryEntry(opId: string) {
  return resolveEntry(opId, (e) => ({ ...e, status: "pending", error: undefined }));
}
/** Conflict → keep this device's version (overwrite the server copy deliberately). */
export function keepMine(opId: string) {
  return resolveEntry(opId, (e) =>
    e.op.kind === "create" ? e : { ...e, status: "pending", error: undefined, server: undefined, op: { ...e.op, force: true } },
  );
}
/** Conflict/failure → drop this device's change and keep the server's. */
export function discardEntry(opId: string) {
  return withLock(async () => {
    await deleteEntry(opId);
    await reload();
    changed();
  }).then(() => syncNow());
}
function resolveEntry(opId: string, fn: (e: OutboxEntry) => OutboxEntry) {
  return withLock(async () => {
    const e = (await readOutbox()).find((x) => x.opId === opId);
    if (e) await putEntry(fn(e));
    await reload();
    changed();
  }).then(() => syncNow());
}

/* ------------------------------------------------------------------ sync */

let syncing: Promise<void> | null = null;

/** Push queued changes in order, then pull the latest data. Safe to call any time. */
export function syncNow(opts: { pull?: boolean } = {}): Promise<void> {
  if (syncing) return syncing;
  if (!navigator.onLine) {
    setState({ online: false });
    return Promise.resolve();
  }
  syncing = withLock(() => runSync(opts.pull ?? true)).finally(() => {
    syncing = null;
  });
  return syncing;
}

async function runSync(pull: boolean) {
  setState({ syncing: true, online: true });
  let pushedAny = false;
  let error: string | null = null;
  try {
    await reload();
    const resolvedIds = new Map<string, { id: string; updatedAt: string | null }>();

    const order = mine(await readOutbox()).map((e) => e.opId);
    for (const opId of order) {
      // Re-read: applying an earlier change may have re-based this one.
      const entry = mine(await readOutbox()).find((e) => e.opId === opId);
      if (!entry) continue;
      if (entry.status !== "pending") break; // waiting for a decision — keep order
      let op = entry.op;
      // A change to a record created earlier in this queue: point it at the server's record.
      if (op.kind !== "create" && isLocalId(op.txnId)) {
        const r = resolvedIds.get(op.txnId);
        if (!r) break;
        op = { ...op, txnId: r.id, baseUpdatedAt: r.updatedAt ?? op.baseUpdatedAt };
      }
      await putEntry({ ...entry, op, attempts: entry.attempts + 1 });

      const res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: [op] }),
        cache: "no-store",
      });
      if (res.status === 401) {
        setState({ signedOut: true });
        error = "Signed out — sign in to sync your changes.";
        break;
      }
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { results } = (await res.json()) as { results: SyncResult[] };
      const r = results[0];
      setState({ signedOut: false });

      if (r.status === "applied") {
        await deleteEntry(entry.opId);
        pushedAny = true;
        const localKey = op.kind === "create" ? LOCAL_PREFIX + op.clientRef : op.txnId;
        if (r.txnId) {
          resolvedIds.set(localKey, { id: r.txnId, updatedAt: r.updatedAt });
          // Later queued edits of this record were based on the version before this change.
          for (const later of mine(await readOutbox())) {
            if (later.op.kind !== "create" && (later.op.txnId === localKey || later.op.txnId === r.txnId)) {
              await putEntry({ ...later, op: { ...later.op, txnId: r.txnId, baseUpdatedAt: r.updatedAt ?? later.op.baseUpdatedAt } });
            }
          }
        }
      } else if (r.status === "conflict") {
        await putEntry({ ...entry, op, attempts: entry.attempts + 1, status: "conflict", error: r.message, server: r.server });
        break;
      } else {
        await putEntry({ ...entry, op, attempts: entry.attempts + 1, status: "failed", error: r.error });
        break;
      }
    }

    if (pull && !state.signedOut) await pullSnapshot();
    failures = 0;
    setState({ unreachable: false });
  } catch (err) {
    failures++;
    error = err instanceof TypeError ? "Can't reach the server — will retry automatically." : (err as Error).message;
    setState({ unreachable: err instanceof TypeError });
    scheduleRetry();
  } finally {
    const lastSyncAt = error ? state.lastSyncAt : new Date().toISOString();
    await writeMeta({ lastSyncAt, lastError: error });
    await reload();
    setState({ syncing: false, lastSyncAt, lastError: error });
    if (pushedAny) {
      changed();
      serverChangeListeners.forEach((l) => l());
    }
  }
}

async function pullSnapshot() {
  const res = await fetch("/api/sync/snapshot", {
    headers: snapshot ? { "If-None-Match": `"${snapshot.version}"` } : {},
    cache: "no-store",
  });
  if (res.status === 304) return;
  if (res.status === 401) {
    setState({ signedOut: true });
    return;
  }
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const next = (await res.json()) as Snapshot;
  if (state.userId && next.user.id !== state.userId) return;
  await writeSnapshot(next);
  setState({ userId: next.user.id });
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(5 * 60_000, 15_000 * 2 ** Math.min(failures - 1, 5));
  retryTimer = setTimeout(() => void syncNow(), delay);
}

/** Debounced pull after the online app saves something directly to the server. */
let pullTimer: ReturnType<typeof setTimeout> | null = null;
export function requestPull() {
  if (!started) return;
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => void syncNow(), 1500);
}

/** Sign-out: remove this device's copy (the caller warns about unsynced changes first). */
export async function wipeDevice() {
  await withLock(async () => {
    await clearDevice();
    snapshot = null;
    outbox = [];
    publish();
    changed();
  });
}
