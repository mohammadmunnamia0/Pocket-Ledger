import "server-only";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "./auth/session";
import { toFailure, type ActionResult } from "./errors";

/**
 * Wrap a server action body: re-verify the session (never trust the client), run the
 * mutation, refresh the client router so every derived figure re-renders from the DB,
 * and convert errors into a user-facing result.
 */
export async function runAction<T>(
  fn: (userId: string) => Promise<T>,
  message?: string,
): Promise<ActionResult<T>> {
  try {
    const user = await requireUser();
    const data = await fn(user.id);
    refresh();
    return { ok: true, data, message };
  } catch (err) {
    unstable_rethrow(err);
    return toFailure(err);
  }
}
