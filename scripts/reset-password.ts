/**
 * Reset the account password when you can't sign in (there is no email-based reset).
 *
 *   npx tsx scripts/reset-password.ts you@example.com "new-password"
 *
 * Uses MONGODB_URI / MONGODB_DB from .env.local, so it changes the database those point to.
 */
import { existsSync } from "node:fs";
import { resetPassword } from "../src/lib/services/setup";
import { disconnectDB } from "../src/lib/db/connect";
import { LoginAttempt } from "../src/lib/db/models";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npx tsx scripts/reset-password.ts <email> "<new password>"');
  process.exit(1);
}
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const updated = await resetPassword(email, password);
if (updated) {
  // Lift any sign-in lock for this email, from every network.
  await LoginAttempt.deleteMany({ key: { $regex: `^${email.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|` } });
  console.log(`Password updated for ${email}. Any sign-in lock was cleared.`);
} else {
  console.error(`No account found with email ${email}.`);
  process.exitCode = 1;
}
await disconnectDB();
