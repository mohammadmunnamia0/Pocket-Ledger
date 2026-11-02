"use client";

import { useSyncExternalStore } from "react";
import type { ActionResult } from "../errors";
import type { TxnInputRaw } from "../validation";
import {
  getLocalData,
  getSyncState,
  isConnectionError,
  queueCreate,
  queueDelete,
  queueUpdate,
  reportUnreachable,
  subscribeLocalData,
  subscribeSync,
  type LocalData,
  type SyncState,
} from "./engine";

const SERVER_STATE: SyncState = {
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
const SERVER_DATA: LocalData = { snapshot: null, outbox: [], version: 0 };

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, () => SERVER_STATE);
}

export function useLocalData(): LocalData {
  return useSyncExternalStore(subscribeLocalData, getLocalData, () => SERVER_DATA);
}

const OFFLINE_SAVED = "Saved on this device — it will sync automatically when you're back online.";

/** How long a save may wait for the server before it is kept on the device instead. */
const ONLINE_SAVE_TIMEOUT = 10_000;

/** True when the last save was kept on this device (the caller should not wait on the server, e.g. for navigation). */
let lastSavedOnDevice = false;
export const savedOnDevice = () => lastSavedOnDevice;

/**
 * Save through the server when it answers; otherwise queue the change on the device, so
 * nothing typed is lost. "Otherwise" covers being offline, the connection dropping
 * mid-save, and a connection that is up but gets no answer (the browser still says online).
 *
 * Callers give the online save and the queued change the same id (clientRef / opId), so
 * if a slow online save does land after all, the queued copy is recognised — never a duplicate.
 */
export async function saveWithFallback(
  online: () => Promise<ActionResult<unknown>>,
  offline: () => Promise<ActionResult<unknown>>,
): Promise<ActionResult<unknown>> {
  lastSavedOnDevice = false;
  const queue = async () => {
    const r = await offline();
    lastSavedOnDevice = r.ok;
    return r;
  };
  if (typeof navigator !== "undefined" && !navigator.onLine) return queue();
  // Already known to be unreachable: don't make the user wait for another timeout.
  if (getSyncState().unreachable) return queue();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ONLINE_SAVE_TIMEOUT);
  });
  try {
    const r = await Promise.race([online(), timeout]);
    if (r !== "timeout") return r;
    reportUnreachable();
    return queue();
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    reportUnreachable();
    return queue();
  } finally {
    clearTimeout(timer);
  }
}

function asResult(r: Awaited<ReturnType<typeof queueCreate>>): ActionResult<unknown> {
  return r.ok ? { ok: true, data: r.id, message: OFFLINE_SAVED } : { ok: false, error: r.error, fieldErrors: r.fieldErrors };
}

/** An id for one save attempt — shared by the online save and its offline fallback. */
export const newSaveId = () => crypto.randomUUID();

export const offlineCreate = async (raw: TxnInputRaw, clientRef?: string) => asResult(await queueCreate(raw, clientRef));
export const offlineUpdate = async (target: { id: string; updatedAt: string }, raw: TxnInputRaw, opId?: string) => asResult(await queueUpdate(target, raw, opId));
export const offlineDelete = async (target: { id: string; updatedAt: string; title: string }) => asResult(await queueDelete(target));
