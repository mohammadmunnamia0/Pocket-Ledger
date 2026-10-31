"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CategoryOptions, NativeSelect, type CategoryChoice } from "@/components/form-controls";
import { TXN_TYPES } from "@/lib/constants";
import { TXN_TYPE_LABELS } from "@/lib/labels";

/** URL-driven filters, so every filtered view is shareable and survives reloads. */
export function TransactionFilters({ categories, persons }: { categories: CategoryChoice[]; persons: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Debounced search
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => update({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["q", "type", "flow", "status", "category", "person", "from", "to"].some((k) => params.get(k));

  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)_auto_auto_auto]" aria-busy={isPending}>
      <div className="relative sm:col-span-2 lg:col-span-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, notes, items…" className="h-9 pl-8" aria-label="Search transactions" />
      </div>
      <NativeSelect
        aria-label="Type"
        value={params.get("flow") ? `flow:${params.get("flow")}` : (params.get("type") ?? "")}
        onChange={(e) => {
          const v = e.target.value;
          update(v.startsWith("flow:") ? { flow: v.slice(5), type: "" } : { type: v, flow: "" });
        }}
      >
        <option value="">All types</option>
        <option value="flow:out">Money out (spends &amp; savings)</option>
        <option value="flow:in">Money in (income)</option>
        {TXN_TYPES.map((t) => (
          <option key={t} value={t}>
            {TXN_TYPE_LABELS[t]}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Status" value={params.get("status") ?? ""} onChange={(e) => update({ status: e.target.value })}>
        <option value="">Paid & pending</option>
        <option value="paid">Paid</option>
        <option value="pending">Pending</option>
      </NativeSelect>
      <NativeSelect aria-label="Category" value={params.get("category") ?? ""} onChange={(e) => update({ category: e.target.value })}>
        <option value="">All categories</option>
        <CategoryOptions categories={categories} />
      </NativeSelect>
      <NativeSelect aria-label="Person" value={params.get("person") ?? ""} onChange={(e) => update({ person: e.target.value })}>
        <option value="">Anyone</option>
        {persons.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
      {/* Visible "From"/"To" labels: empty date inputs render as blank boxes on iOS. */}
      <DateFilter label="From" value={params.get("from") ?? ""} onChange={(v) => update({ from: v })} />
      <DateFilter label="To" value={params.get("to") ?? ""} onChange={(v) => update({ to: v })} />
      {active ? (
        <Button
          variant="ghost"
          className="h-9"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X /> Clear
        </Button>
      ) : (
        <span className="hidden lg:block" />
      )}
    </div>
  );
}

function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">{label}</span>
      <Input type="date" aria-label={`${label} date`} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 pl-11" />
    </label>
  );
}
