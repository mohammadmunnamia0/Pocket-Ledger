"use client";

import { useSyncExternalStore } from "react";
import type { ActionResult } from "../errors";
import type { TxnInputRaw } from "../validation";
import { getLocalData, getSyncState, queueCreate, queueDelete, queueUpdate, subscribeLocalData, subscribeSync, type LocalData, type SyncState } from "./engine";

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

/** A failed server action caused by the connection (not by the server refusing the change). */
function isNetworkError(err: unknown) {
  return err instanceof TypeError || (err instanceof Error && /fetch|network|load failed|connection/i.test(err.message));
}

const OFFLINE_SAVED = "Saved on this device — it will sync automatically when you're back online.";

/**
 * Save through the server when possible; when offline (or the connection drops mid-save)
 * queue the change on the device instead, so nothing typed is lost.
 */
export async function saveWithFallback(
  online: () => Promise<ActionResult<unknown>>,
  offline: () => Promise<ActionResult<unknown>>,
): Promise<ActionResult<unknown>> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return offline();
  try {
    return await online();
  } catch (err) {
    if (isNetworkError(err)) return offline();
    throw err;
  }
}

function asResult(r: Awaited<ReturnType<typeof queueCreate>>): ActionResult<unknown> {
  return r.ok ? { ok: true, data: r.id, message: OFFLINE_SAVED } : { ok: false, error: r.error, fieldErrors: r.fieldErrors };
}

export const offlineCreate = async (raw: TxnInputRaw) => asResult(await queueCreate(raw));
export const offlineUpdate = async (target: { id: string; updatedAt: string }, raw: TxnInputRaw) => asResult(await queueUpdate(target, raw));
export const offlineDelete = async (target: { id: string; updatedAt: string; title: string }) => asResult(await queueDelete(target));
