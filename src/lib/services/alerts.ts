import { connectDB } from "../db/connect";
import { AlertState, User, oid, type AlertPrefs } from "../db/models";
import type { Alert } from "../alerts/rules";
import { alertPrefsSchema } from "../validation";
import type { z } from "zod";

export interface ShownAlert extends Alert {
  read: boolean;
}

/**
 * Record that these alerts were generated and return the ones that should be shown
 * (not dismissed), flagged with their read state.
 */
export async function syncAlerts(userId: string, alerts: Alert[]): Promise<ShownAlert[]> {
  await connectDB();
  if (alerts.length === 0) return [];
  const uid = oid(userId);
  const now = new Date();
  await AlertState.bulkWrite(
    alerts.map((a) => ({
      updateOne: {
        filter: { userId: uid, key: a.key },
        update: {
          $setOnInsert: { firstSeenAt: now },
          $set: { lastSeenAt: now, type: a.type, priority: a.priority, title: a.title, message: a.message },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  const states = await AlertState.find({ userId: uid, key: { $in: alerts.map((a) => a.key) } }, { key: 1, readAt: 1, dismissedAt: 1 }).lean();
  const byKey = new Map(states.map((s) => [s.key, s]));
  return alerts
    .filter((a) => !byKey.get(a.key)?.dismissedAt)
    .map((a) => ({ ...a, read: !!byKey.get(a.key)?.readAt }));
}

export async function setAlertState(userId: string, key: string, change: "read" | "dismiss") {
  await connectDB();
  const field = change === "read" ? "readAt" : "dismissedAt";
  await AlertState.updateOne({ userId: oid(userId), key }, { $set: { [field]: new Date(), ...(change === "dismiss" ? { readAt: new Date() } : {}) } });
}

export async function markAllAlertsRead(userId: string) {
  await connectDB();
  await AlertState.updateMany({ userId: oid(userId), readAt: null }, { $set: { readAt: new Date() } });
}

export async function getAlertHistory(userId: string, limit = 100) {
  await connectDB();
  const rows = await AlertState.find({ userId: oid(userId) }).sort({ lastSeenAt: -1 }).limit(limit).lean();
  return rows.map((r) => ({
    key: r.key,
    type: r.type,
    priority: r.priority,
    title: r.title,
    message: r.message,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
    dismissedAt: r.dismissedAt?.toISOString() ?? null,
  }));
}

export async function restoreAlert(userId: string, key: string) {
  await connectDB();
  await AlertState.updateOne({ userId: oid(userId), key }, { $set: { dismissedAt: null } });
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { enabled: {}, minBalance: 200000, spendWarnPct: 75, savingsReminderDay: 0 };

export async function getAlertPrefs(userId: string): Promise<AlertPrefs> {
  await connectDB();
  const user = await User.findById(oid(userId), { "prefs.alerts": 1 }).lean();
  return { ...DEFAULT_ALERT_PREFS, ...(user?.prefs?.alerts ?? {}) };
}

export async function saveAlertPrefs(userId: string, raw: z.input<typeof alertPrefsSchema>) {
  const input = alertPrefsSchema.parse(raw);
  await connectDB();
  await User.updateOne({ _id: oid(userId) }, { $set: { "prefs.alerts": input } });
}
