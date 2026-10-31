"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireUser, startSession } from "@/lib/auth/session";
import { changePassword, createUser, hasAnyUser, verifyCredentials } from "@/lib/services/setup";
import { clearFailures, lockRemaining, recordFailure } from "@/lib/services/login-guard";
import { toFailure, type ActionResult } from "@/lib/errors";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

/** Mobile keyboards add capitals and stray spaces to emails — normalise before validating. */
const emailField = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email("Enter a valid email"));

const loginSchema = z.object({ email: emailField, password: z.string().min(1, "Enter your password") });

/** Failure state keeps the email so the form can refill it (React resets forms after an action). */
export type LoginState = { ok: false; error: string; email: string } | null;

const maskEmail = (e: string) => e.replace(/^(.{2}).*(@.*)$/, "$1***$2");

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  const rawEmail = String(form.get("email") ?? "");
  const parsed = loginSchema.safeParse({ email: rawEmail, password: form.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details", email: rawEmail };
  const { email, password } = parsed.data;

  // Throttle per email + network, stored in the DB so it holds across serverless instances.
  const key = `${email}|${await clientIp()}`;
  const wait = await lockRemaining(key);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60000);
    return { ok: false, error: `Too many incorrect attempts. Please wait ${minutes} minute${minutes > 1 ? "s" : ""} and try again.`, email };
  }

  const result = await verifyCredentials(email, password);
  if (!result.userId) {
    // Logged server-side (never the password) so failures can be diagnosed from the logs.
    console.warn(`[auth] sign-in failed for ${maskEmail(email)}: ${result.reason}`);
    const left = await recordFailure(key);
    const hint = left > 0 && left <= 3 ? ` ${left} attempt${left > 1 ? "s" : ""} left before a short lock.` : "";
    return {
      ok: false,
      error:
        left === 0
          ? "Too many incorrect attempts. Please wait 10 minutes and try again."
          : `Incorrect email or password. Check the email you signed up with — passwords are case-sensitive.${hint}`,
      email,
    };
  }
  await clearFailures(key);
  await startSession(result.userId);
  const next = String(form.get("next") || "/");
  // Only same-origin paths ("/x"), never "//host" or "/\host".
  redirect(/^\/(?![/\\])/.test(next) ? next : "/");
}

const setupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: emailField,
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
