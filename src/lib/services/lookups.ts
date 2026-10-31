import { connectDB } from "../db/connect";
import {
  Account,
  Category,
  Person,
  SavingsGoal,
  oid,
  type AccountKind,
  type CategoryNature,
  type GoalKind,
  type GoalStatus,
} from "../db/models";

export interface CategoryOption {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  /** "Food & Groceries › Chicken" */
  label: string;
  /** Id of the top-level category (self for top-level). */
  rootId: string;
  rootName: string;
  nature: CategoryNature;
  systemKey: string | null;
  sortOrder: number;
}

export interface Lookups {
  categories: CategoryOption[];
  accounts: { id: string; name: string; kind: AccountKind; isDefault: boolean; archived: boolean }[];
  persons: { id: string; name: string; relation: string | null; archived: boolean }[];
  goals: { id: string; name: string; kind: GoalKind; status: GoalStatus; accountId: string | null }[];
}

export async function getLookups(userId: string): Promise<Lookups> {
  await connectDB();
  const uid = oid(userId);
  const [cats, accounts, persons, goals] = await Promise.all([
    Category.find({ userId: uid }).sort({ sortOrder: 1, name: 1 }).lean(),
    Account.find({ userId: uid }).sort({ isDefault: -1, name: 1 }).lean(),
    Person.find({ userId: uid }).sort({ name: 1 }).lean(),
    SavingsGoal.find({ userId: uid }).sort({ createdAt: 1 }).lean(),
  ]);

  const byId = new Map(cats.map((c) => [c._id.toString(), c]));
  const categories: CategoryOption[] = cats.map((c) => {
    const parent = c.parentId ? byId.get(c.parentId.toString()) : undefined;
    return {
      id: c._id.toString(),
      name: c.name,
      parentId: parent ? parent._id.toString() : null,
      parentName: parent?.name ?? null,
      label: parent ? `${parent.name} › ${c.name}` : c.name,
      rootId: (parent ?? c)._id.toString(),
      rootName: (parent ?? c).name,
      nature: parent?.nature ?? c.nature,
      systemKey: c.systemKey ?? null,
      sortOrder: parent ? parent.sortOrder * 1000 + c.sortOrder : c.sortOrder * 1000 - 1,
    };
  });
  categories.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

  return {
    categories,
    accounts: accounts.map((a) => ({
      id: a._id.toString(),
      name: a.name,
      kind: a.kind,
      isDefault: a.isDefault,
      archived: a.archived,
    })),
    persons: persons.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      relation: p.relation ?? null,
      archived: p.archived,
    })),
    goals: goals.map((g) => ({
      id: g._id.toString(),
      name: g.name,
      kind: g.kind,
      status: g.status,
      accountId: g.accountId?.toString() ?? null,
    })),
  };
}

export function categoryMap(lookups: Lookups): Map<string, CategoryOption> {
  return new Map(lookups.categories.map((c) => [c.id, c]));
}

/** Ids of a category and all its sub-categories. */
export function categoryWithChildren(lookups: Lookups, id: string): string[] {
  return lookups.categories.filter((c) => c.id === id || c.parentId === id).map((c) => c.id);
}
