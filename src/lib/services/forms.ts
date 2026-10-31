import { connectDB } from "../db/connect";
import { User, oid } from "../db/models";
import { todayISO } from "../dates";
import { getLookups } from "./lookups";
import { listIncomeOptions } from "./transactions";

/** Lookups and remembered defaults for the transaction forms. */
export async function getFormContext(userId: string) {
  await connectDB();
  const [lookups, incomes, user] = await Promise.all([
    getLookups(userId),
    listIncomeOptions(userId),
    User.findById(oid(userId), { prefs: 1 }).lean(),
  ]);
  return {
    lookups: {
      categories: lookups.categories,
      accounts: lookups.accounts,
      persons: lookups.persons,
      incomes,
    },
    defaults: {
      date: todayISO(),
      categoryId: user?.prefs?.lastCategoryId?.toString() ?? null,
      paymentMethod: user?.prefs?.lastPaymentMethod ?? "cash",
      accountId: user?.prefs?.lastAccountId?.toString() ?? null,
    },
    raw: lookups,
  };
}
