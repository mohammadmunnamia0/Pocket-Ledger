/**
 * Balance of each account (Bank, Cash, Mobile Banking…) from the transactions, and the rule
 * that a payment can't take an account below zero.
 */
import type { ClientSession, Types } from "mongoose";
import { connectDB } from "../db/connect";
import { Account, SavingsGoal, Transaction, oid, HOLDING_KINDS } from "../db/models";
import { AppError } from "../errors";
import { formatTaka } from "../money";

/**
 * Balance per account. Savings deposits move money to the goal's linked account, if any.
 * Lending & borrowing (principal and repayments) never change an account: loans are kept as
 * separate receivable / payable records.
 */
export async function getAccountBalances(userId: string, session?: ClientSession): Promise<Map<string, number>> {
  await connectDB();
  const uid = oid(userId);
  const [groups, goals] = await Promise.all([
    Transaction.aggregate<{ _id: { type: string; a: Types.ObjectId | null; to: Types.ObjectId | null; g: Types.ObjectId | null }; v: number }>([
      { $match: { userId: uid, status: "paid" } },
      { $group: { _id: { type: "$type", a: "$accountId", to: "$toAccountId", g: "$goalId" }, v: { $sum: "$amount" } } },
    ]).session(session ?? null),
    SavingsGoal.find({ userId: uid }, { accountId: 1 }, { session }).lean(),
  ]);
  const goalAccount = new Map(goals.map((g) => [g._id.toString(), g.accountId?.toString() ?? null]));
  const bal = new Map<string, number>();
  const add = (acc: string | null | undefined, v: number) => {
    if (!acc) return;
    bal.set(acc, (bal.get(acc) ?? 0) + v);
  };
  for (const { _id, v } of groups) {
    const a = _id.a?.toString();
    switch (_id.type) {
      case "income":
      case "invest_in":
        add(a, v);
        break;
      case "expense":
      case "invest_out":
        add(a, -v);
        break;
      // loan_in / loan_out: deliberately not counted (see above).
      case "transfer":
        add(a, -v);
        add(_id.to?.toString(), v);
        break;
      case "savings_deposit": {
        const target = _id.g ? goalAccount.get(_id.g.toString()) : null;
        if (target && target !== a) {
          add(a, -v);
          add(target, v);
        }
        break;
      }
      case "savings_withdrawal": {
        const holder = _id.g ? goalAccount.get(_id.g.toString()) : null;
        if (holder && holder !== a) {
          add(holder, -v);
          add(a, v);
        }
        break;
      }
    }
  }
  return bal;
}

/**
 * After a change (inside its database transaction): a Bank / Cash / Mobile Banking account
 * that went down must not end below zero — you can't pay from a place that doesn't hold the
 * money. Accounts that didn't go down are left alone (so an old negative balance can still
 * be topped up), and a change that adds money is never refused.
 */
export async function assertNoOverdraw(userId: string, before: Map<string, number>, session: ClientSession): Promise<void> {
  const after = await getAccountBalances(userId, session);
  const ids = [...new Set([...before.keys(), ...after.keys()])].filter((id) => (after.get(id) ?? 0) < 0 && (after.get(id) ?? 0) < (before.get(id) ?? 0));
  if (ids.length === 0) return;
  const accounts = await Account.find({ _id: { $in: ids.map(oid) }, userId: oid(userId), kind: { $in: HOLDING_KINDS } }, { name: 1 }, { session }).lean();
  const a = accounts[0];
  if (!a) return;
  const had = before.get(a._id.toString()) ?? 0;
  const needed = had - (after.get(a._id.toString()) ?? 0);
  throw new AppError(
    `Not enough money in ${a.name}: it has ${formatTaka(Math.max(0, had))}, this needs ${formatTaka(needed)}. Choose another place to pay from, or move money into ${a.name} first.`,
  );
}
