import { connectDB } from "../db/connect";
import { LoginAttempt } from "../db/models";

/** Failures allowed per email + network within the window before a short lock. */
export const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;

/** Milliseconds until sign-in is allowed again, or 0 when not locked. */
export async function lockRemaining(key: string): Promise<number> {
  await connectDB();
  const doc = await LoginAttempt.findOne({ key }, { lockedUntil: 1 }).lean();
  const left = doc?.lockedUntil ? doc.lockedUntil.getTime() - Date.now() : 0;
  return Math.max(0, left);
}

/** Record a failed attempt; returns attempts left before a lock (0 = now locked). */
export async function recordFailure(key: string): Promise<number> {
  await connectDB();
  const now = new Date();
  const doc = await LoginAttempt.findOne({ key }).lean();
  const fresh = !doc || now.getTime() - doc.windowStart.getTime() > WINDOW_MS;
  const failures = fresh ? 1 : doc.failures + 1;
  const locked = failures >= MAX_FAILURES;
  await LoginAttempt.updateOne(
    { key },
    {
      $set: {
        failures: locked ? 0 : failures,
        windowStart: fresh || locked ? now : doc!.windowStart,
        lockedUntil: locked ? new Date(now.getTime() + LOCK_MS) : null,
        expiresAt: new Date(now.getTime() + WINDOW_MS + LOCK_MS),
      },
    },
    { upsert: true },
  );
  return locked ? 0 : MAX_FAILURES - failures;
}

export async function clearFailures(key: string): Promise<void> {
  await connectDB();
  await LoginAttempt.deleteOne({ key });
}
