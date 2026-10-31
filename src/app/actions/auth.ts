"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireUser, startSession } from "@/lib/auth/session";
import { changePassword, createUser, hasAnyUser, verifyCredentials } from "@/lib/services/setup";
import { toFailure, type ActionResult } from "@/lib/errors";

// Best-effort brute-force protection (per server instance).
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60 * 1000;

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

const loginSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export async function loginAction(_: unknown, form: FormData): Promise<ActionResult> {
  const key = await clientKey();
  const state = attempts.get(key);
  if (state && state.count >= MAX_ATTEMPTS && state.until > Date.now()) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return toFailure(parsed.error);

  const userId = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!userId) {
    const count = (state && state.until > Date.now() ? state.count : 0) + 1;
    attempts.set(key, { count, until: Date.now() + LOCK_MS });
    return { ok: false, error: "Incorrect email or password" };
  }
  attempts.delete(key);
  await startSession(userId);
  const next = String(form.get("next") || "/");
  // Only same-origin paths ("/x"), never "//host" or "/\host".
  redirect(/^\/(?![/\\])/.test(next) ? next : "/");
}

const setupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
});

/** First-run account creation. Only allowed while no account exists. */
export async function setupAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    if (await hasAnyUser()) return { ok: false, error: "An account already exists. Please sign in." };
    const input = setupSchema.parse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
    const userId = await createUser(input);
    await startSession(userId);
  } catch (err) {
    return toFailure(err);
  }
  redirect("/");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function changePasswordAction(input: { current: string; next: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await changePassword(user.id, input.current, input.next);
    return { ok: true, message: "Password updated" };
  } catch (err) {
    return toFailure(err);
  }
}
