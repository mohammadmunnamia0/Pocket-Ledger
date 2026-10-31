"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field, NativeSelect, CategoryOptions } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { deleteCategoryAction, saveCategoryAction } from "@/app/actions/ledger";
import type { CategoryNature } from "@/lib/constants";

export interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  label: string;
  nature: CategoryNature;
  systemKey: string | null;
  usage: number;
}

type Editing = { mode: "create"; parentId: string } | { mode: "edit"; cat: CategoryRow } | { mode: "delete"; cat: CategoryRow } | null;

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const [editing, setEditing] = useState<Editing>(null);
  const roots = categories.filter((c) => !c.parentId);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing({ mode: "create", parentId: "" })}>
          <Plus /> New category
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {roots.map((root) => {
          const children = categories.filter((c) => c.parentId === root.id);
          return (
            <div key={root.id} className="rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{root.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {root.nature === "saving" ? "Investment / saving — reported separately from spending" : "Spending"}
                    {root.usage > 0 && ` · ${root.usage} uses`}
                  </p>
                </div>
                <RowActions cat={root} onEdit={setEditing} />
              </div>
              <ul className="px-2 py-1">
                {children.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <span className="truncate text-sm">
                      {c.name}
                      {c.usage > 0 && <span className="ml-2 text-xs text-muted-foreground">{c.usage}</span>}
                    </span>
                    <RowActions cat={c} onEdit={setEditing} />
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: "create", parentId: root.id })}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    <Plus className="size-3.5" /> Add sub-category
                  </button>
                </li>
              </ul>
            </div>
          );
        })}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing?.mode === "delete" ? (
            <DeleteForm cat={editing.cat} categories={categories} onDone={() => setEditing(null)} />
          ) : editing ? (
            <CategoryForm editing={editing} roots={roots} onDone={() => setEditing(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RowActions({ cat, onEdit }: { cat: CategoryRow; onEdit: (e: Editing) => void }) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <Button variant="ghost" size="icon-xs" aria-label={`Edit ${cat.name}`} onClick={() => onEdit({ mode: "edit", cat })}>
        <Pencil />
      </Button>
      {cat.systemKey !== "others" && (
        <Button variant="ghost" size="icon-xs" aria-label={`Delete ${cat.name}`} onClick={() => onEdit({ mode: "delete", cat })}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

function CategoryForm({
  editing,
  roots,
  onDone,
}: {
  editing: Exclude<Editing, null | { mode: "delete" }>;
  roots: CategoryRow[];
  onDone: () => void;
}) {
  const cat = editing.mode === "edit" ? editing.cat : null;
  const [name, setName] = useState(cat?.name ?? "");
  const [parentId, setParentId] = useState(cat ? (cat.parentId ?? "") : editing.mode === "create" ? editing.parentId : "");
  const [nature, setNature] = useState<CategoryNature>(cat?.nature ?? "consumption");
  const { pending, run } = useAction();
  const isRootWithChildren = !!cat && !cat.parentId;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveCategoryAction({ name, parentId: parentId || undefined, nature }, cat?.id), { onSuccess: onDone });
      }}
    >
      <DialogHeader>
        <DialogTitle>{cat ? "Edit category" : "New category"}</DialogTitle>
      </DialogHeader>
      <Field label="Name" htmlFor="cat-name">
        <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
      </Field>
      <Field label="Parent" htmlFor="cat-parent" hint={isRootWithChildren ? "Top-level categories with sub-categories stay top-level" : undefined}>
        <NativeSelect id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={isRootWithChildren}>
          <option value="">None — top-level category</option>
          {roots
            .filter((r) => r.id !== cat?.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      {!parentId && (
        <Field label="Reporting" htmlFor="cat-nature" hint="Investments are shown under Savings / Transfers in reports, not as consumption.">
          <NativeSelect id="cat-nature" value={nature} onChange={(e) => setNature(e.target.value as CategoryNature)}>
            <option value="consumption">Spending (consumption)</option>
            <option value="saving">Investment / saving</option>
          </NativeSelect>
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}

function DeleteForm({ cat, categories, onDone }: { cat: CategoryRow; categories: CategoryRow[]; onDone: () => void }) {
  const affected = new Set([cat.id, ...categories.filter((c) => c.parentId === cat.id).map((c) => c.id)]);
  const uses = categories.filter((c) => affected.has(c.id)).reduce((s, c) => s + c.usage, 0);
  const others = categories.find((c) => c.systemKey === "others");
  const [target, setTarget] = useState(others && !affected.has(others.id) ? others.id : "");
  const { pending, run } = useAction();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => deleteCategoryAction(cat.id, target || undefined), { onSuccess: onDone });
      }}
    >
      <DialogHeader>
        <DialogTitle>Delete “{cat.name}”?</DialogTitle>
        <DialogDescription>
          {affected.size > 1 ? `Its ${affected.size - 1} sub-categories are deleted too. ` : ""}
          {uses > 0 ? `${uses} transaction entries use it and will be moved — nothing disappears from your history or reports.` : "No transactions use it."}
        </DialogDescription>
      </DialogHeader>
      {uses > 0 && (
        <Field label="Move transactions to" htmlFor="cat-target">
          <NativeSelect id="cat-target" value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="">Choose…</option>
            <CategoryOptions categories={categories.filter((c) => !affected.has(c.id))} />
          </NativeSelect>
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Delete
        </Button>
      </div>
    </form>
  );
}
