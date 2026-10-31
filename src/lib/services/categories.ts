import { connectDB } from "../db/connect";
import { Account, Category, SavingsGoal, Transaction, oid } from "../db/models";
import { AppError, NotFoundError } from "../errors";
import { accountInputSchema, categoryInputSchema } from "../validation";
import type { z } from "zod";

/* ------------------------------------------------------------------ Categories */

export async function getCategoryUsage(userId: string): Promise<Map<string, number>> {
  await connectDB();
  const uid = oid(userId);
  const [direct, items] = await Promise.all([
    Transaction.aggregate<{ _id: unknown; n: number }>([
      { $match: { userId: uid, categoryId: { $type: "objectId" } } },
      { $group: { _id: "$categoryId", n: { $sum: 1 } } },
    ]),
    Transaction.aggregate<{ _id: unknown; n: number }>([
      { $match: { userId: uid, "items.categoryId": { $type: "objectId" } } },
      { $unwind: "$items" },
      { $match: { "items.categoryId": { $type: "objectId" } } },
      { $group: { _id: "$items.categoryId", n: { $sum: 1 } } },
    ]),
  ]);
  const usage = new Map<string, number>();
  for (const r of [...direct, ...items]) usage.set(String(r._id), (usage.get(String(r._id)) ?? 0) + r.n);
  return usage;
}

export async function saveCategory(userId: string, raw: z.input<typeof categoryInputSchema>, id?: string): Promise<string> {
  const input = categoryInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  if (input.parentId) {
    const parent = await Category.findOne({ _id: oid(input.parentId), userId: uid }, { parentId: 1 }).lean();
    if (!parent) throw new NotFoundError("Parent category");
    if (parent.parentId) throw new AppError("Sub-categories can only be one level deep");
    if (id && input.parentId === id) throw new AppError("A category can't be its own parent");
  }
  const parentId = input.parentId ? oid(input.parentId) : null;
  try {
    if (id) {
      const existing = await Category.findOne({ _id: oid(id), userId: uid }).lean();
      if (!existing) throw new NotFoundError("Category");
      if (parentId && (await Category.exists({ userId: uid, parentId: existing._id }))) {
        throw new AppError("This category has sub-categories, so it must stay top-level");
      }
      await Category.updateOne({ _id: existing._id }, { $set: { name: input.name, parentId, nature: input.nature } });
      // Sub-categories follow their parent's nature so reports stay consistent.
      if (!parentId) await Category.updateMany({ userId: uid, parentId: existing._id }, { $set: { nature: input.nature } });
      return id;
    }
    const siblings = await Category.countDocuments({ userId: uid, parentId });
    let nature = input.nature;
    if (parentId) nature = (await Category.findById(parentId, { nature: 1 }).lean())?.nature ?? nature;
    const created = await Category.create({ userId: uid, name: input.name, parentId, nature, sortOrder: siblings + 100 });
    return created._id.toString();
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      throw new AppError("A category with this name already exists here");
    }
    throw err;
  }
}

/**
 * Delete a category. Transactions using it (or its sub-categories) are moved to
 * `reassignTo` so no expense ever loses its category or disappears from reports.
 */
export async function deleteCategory(userId: string, id: string, reassignTo?: string) {
  await connectDB();
  const uid = oid(userId);
  const cat = await Category.findOne({ _id: oid(id), userId: uid }).lean();
  if (!cat) throw new NotFoundError("Category");
  if (cat.systemKey === "others") throw new AppError("“Others” is the fallback category and can't be deleted");

  const children = await Category.find({ userId: uid, parentId: cat._id }, { _id: 1 }).lean();
  const affected = [cat._id, ...children.map((c) => c._id)];
  const inUse = await Transaction.exists({ userId: uid, $or: [{ categoryId: { $in: affected } }, { "items.categoryId": { $in: affected } }] });

  let target = reassignTo ? oid(reassignTo) : null;
  if (inUse) {
    if (!target) {
      target = (await Category.findOne({ userId: uid, systemKey: "others" }, { _id: 1 }).lean())?._id ?? null;
    }
    if (!target || affected.some((a) => a.equals(target!))) {
      throw new AppError("Choose a different category to move existing transactions to");
    }
    if (!(await Category.exists({ _id: target, userId: uid }))) throw new NotFoundError("Target category");
    await Transaction.updateMany({ userId: uid, categoryId: { $in: affected } }, { $set: { categoryId: target } });
    await Transaction.updateMany(
      { userId: uid, "items.categoryId": { $in: affected } },
      { $set: { "items.$[it].categoryId": target } },
      { arrayFilters: [{ "it.categoryId": { $in: affected } }] },
    );
  }
  await Category.deleteMany({ userId: uid, _id: { $in: affected } });
}

/* ------------------------------------------------------------------ Accounts */

export async function saveAccount(userId: string, raw: z.input<typeof accountInputSchema>, id?: string): Promise<string> {
  const input = accountInputSchema.parse(raw);
  await connectDB();
  const uid = oid(userId);
  if (id) {
    const res = await Account.updateOne({ _id: oid(id), userId: uid }, { $set: input });
    if (res.matchedCount === 0) throw new NotFoundError("Account");
    return id;
  }
  return (await Account.create({ ...input, userId: uid }))._id.toString();
}

export async function setDefaultAccount(userId: string, id: string) {
  await connectDB();
  const uid = oid(userId);
  if (!(await Account.exists({ _id: oid(id), userId: uid }))) throw new NotFoundError("Account");
  await Account.updateMany({ userId: uid }, { $set: { isDefault: false } });
  await Account.updateOne({ _id: oid(id), userId: uid }, { $set: { isDefault: true, archived: false } });
}

export async function setAccountArchived(userId: string, id: string, archived: boolean) {
  await connectDB();
  const uid = oid(userId);
  const acc = await Account.findOne({ _id: oid(id), userId: uid }).lean();
  if (!acc) throw new NotFoundError("Account");
  if (archived && acc.isDefault) throw new AppError("Choose another default account before archiving this one");
  await Account.updateOne({ _id: acc._id }, { $set: { archived } });
}

export async function deleteAccount(userId: string, id: string) {
  await connectDB();
  const uid = oid(userId);
  const aid = oid(id);
  const used =
    (await Transaction.exists({ userId: uid, $or: [{ accountId: aid }, { toAccountId: aid }] })) ||
    (await SavingsGoal.exists({ userId: uid, accountId: aid }));
  if (used) throw new AppError("This account has transactions. Archive it instead to keep balances correct.");
  const acc = await Account.findOne({ _id: aid, userId: uid }).lean();
  if (acc?.isDefault) throw new AppError("You can't delete the default account");
  await Account.deleteOne({ _id: aid, userId: uid });
}
