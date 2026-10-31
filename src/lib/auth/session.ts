import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connectDB } from "../db/connect";
import { User, isObjectId } from "../db/models";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./token";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export async function startSession(userId: string) {
  (await cookies()).set(SESSION_COOKIE, await signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Data Access Layer entry point: verifies the session cookie and that the user still
 * exists. Memoized per request, so pages and components can call it freely.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const userId = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !isObjectId(userId)) return null;
  await connectDB();
  const user = await User.findById(userId, { name: 1, email: 1 }).lean();
  return user ? { id: user._id.toString(), name: user.name, email: user.email } : null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
