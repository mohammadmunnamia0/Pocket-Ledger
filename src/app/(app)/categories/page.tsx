import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader, TableSkeleton } from "@/components/common";
import { CategoryManager } from "@/components/category-manager";
import { requireUser } from "@/lib/auth/session";
import { getLookups } from "@/lib/services/lookups";
import { getCategoryUsage } from "@/lib/services/categories";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader title="Categories" description="Create, rename, move and delete expense categories. Sub-categories roll up into their parent in reports." />
      <Suspense fallback={<TableSkeleton rows={10} />}>
        <Categories />
      </Suspense>
    </>
  );
}

async function Categories() {
  const user = await requireUser();
  const [lookups, usage] = await Promise.all([getLookups(user.id), getCategoryUsage(user.id)]);
  return (
    <CategoryManager
      categories={lookups.categories.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        label: c.label,
        nature: c.nature,
        systemKey: c.systemKey,
        usage: usage.get(c.id) ?? 0,
      }))}
    />
  );
}
