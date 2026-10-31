import { connectDB } from "../db/connect";
import { Account, SavingsGoal, Transaction, oid, type GoalKind, type GoalStatus, type Priority } from "../db/models";
import { AppError, NotFoundError } from "../errors";
import { monthOf, todayISO } from "../dates";
import { percent } from "../money";
import { goalInputSchema } from "../validation";
import { createTransaction } from "./transactions";
import type { z } from "zod";

/**
 * Savings goals hold money set aside from the spendable balance. A deposit is a ledger
 * transaction that removes money from spendable funds (FIFO-funded from salaries) and adds
 * it to the goal; a withdrawal does the reverse. Nothing moves without an explicit,
 * user-confirmed transaction.
 */

export interface GoalDTO {
  id: string;
  name: string;
  kind: GoalKind;
  targetAmount: number;
  targetDate: string | null;
  priority: Priority;
  description: string | null;
  monthlyTarget: number;
  status: GoalStatus;
  accountId: string | null;
  balance: number;
  deposited: number;
  withdrawn: number;
  thisMonthDeposits: number;
  progressPct: number;
  remainingTarget: number;
}

export async function listGoals(userId: string, today: string = todayISO()): Promise<GoalDTO[]> {
  await connectDB();
  const uid = oid(userId);
  const month = monthOf(today);
  const [goals, moves] = await Promise.all([
    SavingsGoal.find({ userId: uid }).sort({ status: 1, priority: 1, createdAt: 1 }).lean(),
    Transaction.aggregate<{ _id: { g: unknown; t: string; cur: boolean }; v: number }>([
      { $match: { userId: uid, type: { $in: ["savings_deposit", "savings_withdrawal"] }, date: { $lte: today } } },
      {
        $group: {
          _id: { g: "$goalId", t: "$type", cur: { $eq: [{ $substrBytes: ["$date", 0, 7] }, month] } },
          v: { $sum: "$amount" },
        },
      },
    ]),
  ]);
  const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return goals
    .map((g) => {
      const id = g._id.toString();
      const mine = moves.filter((m) => String(m._id.g) === id);
      const deposited = mine.filter((m) => m._id.t === "savings_deposit").reduce((s, m) => s + m.v, 0);
      const withdrawn = mine.filter((m) => m._id.t === "savings_withdrawal").reduce((s, m) => s + m.v, 0);
      const thisMonthDeposits = mine.filter((m) => m._id.t === "savings_deposit" && m._id.cur).reduce((s, m) => s + m.v, 0);
      const balance = deposited - withdrawn;
      return {
        id,
        name: g.name,
        kind: g.kind,
        targetAmount: g.targetAmount,
        targetDate: g.targetDate ?? null,
        priority: g.priority,
        description: g.description ?? null,
        monthlyTarget: g.monthlyTarget,
        status: g.status,
        accountId: g.accountId?.toString() ?? null,
        balance,
        deposited,
        withdrawn,
        thisMonthDeposits,
        progressPct: Math.min(100, percent(balance, g.targetAmount)),
        remainingTarget: Math.max(0, g.targetAmount - balance),
      };
    })
    .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || priorityRank[a.priority] - priorityRank[b.priority]);
}

export async function saveGoal(userId: string, raw: z.input<typeof goalInputSchema>, id?: string): Promise<string> {
  const input = goalInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  if (input.accountId && !(await Account.exists({ _id: oid(input.accountId), userId: uid }))) {
    throw new AppError("Selected account does not exist");
  }
  const doc = { ...input, targetDate: input.targetDate ?? null, accountId: input.accountId ? oid(input.accountId) : null };
  if (id) {
    const existing = await SavingsGoal.findOne({ _id: oid(id), userId: uid }, { accountId: 1 }).lean();
    if (!existing) throw new NotFoundError("Savings goal");
    const linkChanged = (existing.accountId?.toString() ?? null) !== (input.accountId ?? null);
    if (linkChanged && (await Transaction.exists({ userId: uid, goalId: existing._id }))) {
      throw new AppError("The linked account can't change after money has moved into this goal — it would rewrite past account balances.");
    }
    await SavingsGoal.updateOne({ _id: existing._id }, { $set: doc });
    return id;
  }
  return (await SavingsGoal.create({ ...doc, userId: uid }))._id.toString();
}

export async function deleteGoal(userId: string, id: string) {
  await connectDB();
  const uid = oid(userId);
  if (await Transaction.exists({ userId: uid, goalId: oid(id) })) {
    throw new AppError("This goal has deposits or withdrawals. Mark it completed or paused instead.");
  }
  await SavingsGoal.deleteOne({ _id: oid(id), userId: uid });
}

export async function moveSavings(
  userId: string,
  input: { goalId: string; direction: "deposit" | "withdraw"; amount: string; date: string; accountId?: string; notes?: string },
) {
  await connectDB();
  const goal = await SavingsGoal.findOne({ _id: oid(input.goalId), userId: oid(userId) }, { name: 1 }).lean();
  if (!goal) throw new NotFoundError("Savings goal");
  const deposit = input.direction === "deposit";
  return createTransaction(userId, {
    type: deposit ? "savings_deposit" : "savings_withdrawal",
    title: `${deposit ? "Saved to" : "Withdrawn from"} ${goal.name}`,
    amount: input.amount,
    date: input.date,
    goalId: input.goalId,
    accountId: input.accountId,
    notes: input.notes,
  });
}
