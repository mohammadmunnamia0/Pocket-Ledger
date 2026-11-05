/**
 * Rebuild every user's stored FIFO salary-funding ledger — needed once after lending &
 * borrowing stopped being part of the remaining balance (borrowed money no longer funds
 * spending, and lending no longer uses salary money).
 *
 *   npx tsx scripts/rebuild-funding.mts           # dry run: reports, changes nothing
 *   npx tsx scripts/rebuild-funding.mts --apply   # rebuilds and saves
 *
 * Each user is rebuilt in one database transaction. If some spending can only be paid for
 * with borrowed money, that user is left unchanged and the expense is reported instead.
 * Uses MONGODB_URI / MONGODB_DB from .env.local, so it changes the database those point to.
 */
import { existsSync } from "node:fs";
import { connectDB, disconnectDB } from "../src/lib/db/connect";
import { LOAN_TYPES } from "../src/lib/constants";
import { FundingAllocation, Transaction, User } from "../src/lib/db/models";
import { LEDGER_START, recomputeFunding, verifyFundingIntegrity, withLedger } from "../src/lib/ledger/engine";

const apply = process.argv.includes("--apply");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

await connectDB();
class DryRun extends Error {}
let failed = 0;

for (const user of await User.find({}, { email: 1 }).lean()) {
  const userId = user._id.toString();
  const loanIds = (await Transaction.find({ userId: user._id, type: { $in: LOAN_TYPES } }, { _id: 1 }).lean()).map((t) => t._id);
  const stale = await FundingAllocation.countDocuments({ userId: user._id, $or: [{ consumerId: { $in: loanIds } }, { sourceId: { $in: loanIds } }] });
  try {
    await withLedger(userId, async (session) => {
      await recomputeFunding(userId, LEDGER_START, session, { reason: "Lending & borrowing left out of the remaining balance" });
      if (!apply) throw new DryRun();
    });
    const check = await verifyFundingIntegrity(userId);
    console.log(`${user.email}: rebuilt — ${stale} loan allocation(s) removed${check.ok ? "" : `; PROBLEMS: ${check.problems.join(" | ")}`}`);
  } catch (e) {
    if (e instanceof DryRun) {
      console.log(`${user.email}: OK — ${loanIds.length} loan entr${loanIds.length === 1 ? "y" : "ies"}, ${stale} loan allocation(s) would be removed`);
    } else {
      failed++;
      console.error(`${user.email}: NOT rebuilt — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
console.log(apply ? "Done." : "Dry run only — nothing was changed. Run again with --apply to save.");
if (failed) process.exitCode = 1;
await disconnectDB();
