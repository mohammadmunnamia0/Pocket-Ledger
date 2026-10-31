import bcrypt from "bcryptjs";
import { connectDB } from "../db/connect";
import { Account, Category, User, oid, type CategoryNature } from "../db/models";
import { AppError } from "../errors";

interface DefaultCategory {
  name: string;
  key?: string;
  nature?: CategoryNature;
  children: (string | { name: string; key: string })[];
}

/** Default category tree. `key`s are stable hooks the app uses (bills, allocations, others). */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: "Utility Bills",
    key: "utility",
    children: [
      { name: "Internet", key: "utility:internet" },
      { name: "Electricity", key: "utility:electricity" },
      { name: "Gas", key: "utility:gas" },
      { name: "Water", key: "utility:water" },
      { name: "Other Bills", key: "utility:other" },
    ],
  },
  { name: "Transport", key: "transport", children: ["Daily Transport", "Emergency Transport", "Family Transport", "Travel"] },
  {
    name: "Food & Groceries",
    key: "food",
    children: ["Chicken", "Fish", "Vegetables", "Milk Powder", "Restaurant", "Street Food", "Snacks"],
  },
  {
    name: "Family & Household",
    key: "family",
    children: ["Family Expenses", "Shoshur Bari Visit", "Household Shopping", "TCB", "Gifts"],
  },
  { name: "Healthcare", key: "health", children: ["Medicine", "Doctor Consultation", "Medical Tests", "Other Healthcare"] },
  { name: "Personal Expenses", key: "personal", children: ["Shopping", "Accessories", "Clothing", "Personal Care"] },
  {
    name: "Suraiya / Family Allocation",
    key: "allocation",
    children: [
      { name: "Monthly Allocation", key: "allocation:monthly" },
      "September Allocation",
      "October Allocation",
      "November Allocation",
      "Other Payments",
    ],
  },
  { name: "Investment & Savings", key: "investment", nature: "saving", children: ["Investment", "Savings", "Deposits"] },
  {
    name: "Banking & Financial Charges",
    key: "banking",
    children: ["Debit Card Charges", "Bank Charges", "Other Financial Expenses"],
  },
  { name: "Entertainment & Hangout", key: "entertainment", children: ["Restaurant", "Friends Hangout", "Shopping", "Treat"] },
  { name: "Others", key: "others", children: [] },
];

export async function hasAnyUser(): Promise<boolean> {
  await connectDB();
  return (await User.estimatedDocumentCount()) > 0;
}

export async function seedDefaults(userId: string): Promise<void> {
  const uid = oid(userId);
  if ((await Category.countDocuments({ userId: uid })) === 0) {
    for (const [i, cat] of DEFAULT_CATEGORIES.entries()) {
      const parent = await Category.create({
        userId: uid,
        name: cat.name,
        parentId: null,
        nature: cat.nature ?? "consumption",
        systemKey: cat.key ?? null,
        sortOrder: i,
      });
      await Category.insertMany(
        cat.children.map((child, j) => ({
          userId: uid,
          name: typeof child === "string" ? child : child.name,
          parentId: parent._id,
          nature: cat.nature ?? "consumption",
          systemKey: typeof child === "string" ? null : child.key,
          sortOrder: j,
        })),
      );
    }
  }
  if ((await Account.countDocuments({ userId: uid })) === 0) {
    await Account.insertMany([
      { userId: uid, name: "Cash", kind: "cash", isDefault: true },
      { userId: uid, name: "Bank Account", kind: "bank" },
      { userId: uid, name: "Mobile Banking", kind: "mobile" },
    ]);
  }
}

export async function createUser(input: { name: string; email: string; password: string }): Promise<string> {
  await connectDB();
  if (input.password.length < 8) throw new AppError("Password must be at least 8 characters");
  const exists = await User.exists({ email: input.email.toLowerCase() });
  if (exists) throw new AppError("An account with this email already exists");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({ name: input.name, email: input.email, passwordHash, prefs: { alerts: {} } });
  await seedDefaults(user._id.toString());
  return user._id.toString();
}

/**
 * Check a sign-in. The reason is for server logs only — the user always sees the same
 * generic message so it never reveals whether an email is registered.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ userId: string | null; reason: "ok" | "unknown-email" | "wrong-password" }> {
  await connectDB();
  const user = await User.findOne({ email: email.toLowerCase().trim() }, { passwordHash: 1 }).lean();
  // Compare against a dummy hash when the user is missing to keep timing uniform.
  const hash = user?.passwordHash ?? "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7mGJr8M3sZ7G6m2X4Zl1yJXQxKkY3W.";
  const ok = await bcrypt.compare(password, hash);
  if (!user) return { userId: null, reason: "unknown-email" };
  return ok ? { userId: user._id.toString(), reason: "ok" } : { userId: null, reason: "wrong-password" };
}

/** Set a new password directly (used by the recovery script — there is no email reset). */
export async function resetPassword(email: string, next: string): Promise<boolean> {
  await connectDB();
  if (next.length < 8) throw new AppError("Password must be at least 8 characters");
  const res = await User.updateOne({ email: email.toLowerCase().trim() }, { $set: { passwordHash: await bcrypt.hash(next, 12) } });
  return res.matchedCount === 1;
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  await connectDB();
  const user = await User.findById(oid(userId), { passwordHash: 1 }).lean();
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) throw new AppError("Current password is incorrect");
  if (next.length < 8) throw new AppError("New password must be at least 8 characters");
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await bcrypt.hash(next, 12) } });
}
