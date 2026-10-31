"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { CategoryOptions, NativeSelect, type CategoryChoice } from "@/components/form-controls";
import { addMonths } from "@/lib/dates";

export function ReportFilters({
  currentMonth,
  categories,
  persons,
}: {
  currentMonth: string;
  categories: CategoryChoice[];
  persons: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const period = params.get("period") ?? "month";
  const month = params.get("month") ?? currentMonth;

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const preset = period === "custom" ? "custom" : month === currentMonth ? "current" : month === addMonths(currentMonth, -1) ? "previous" : "pick";

  return (
    <div className="mb-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-busy={pending}>
      <NativeSelect
        aria-label="Period"
        value={preset}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "current") update({ period: null, month: null });
          else if (v === "previous") update({ period: null, month: addMonths(currentMonth, -1) });
          else if (v === "custom") update({ period: "custom" });
          else update({ period: null, month });
        }}
      >
        <option value="current">Current month</option>
        <option value="previous">Previous month</option>
        <option value="pick">Choose a month…</option>
        <option value="custom">Custom date range</option>
      </NativeSelect>
      {period === "custom" ? (
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
          <Input type="date" aria-label="From" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} className="h-9" />
          <Input type="date" aria-label="To" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} className="h-9" />
        </div>
      ) : (
        <Input type="month" aria-label="Month" value={month} onChange={(e) => update({ month: e.target.value || null })} className="h-9" />
      )}
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
      <NativeSelect aria-label="Payment status" value={params.get("status") ?? ""} onChange={(e) => update({ status: e.target.value })}>
        <option value="">Paid (default)</option>
        <option value="paid">Paid only</option>
        <option value="pending">Pending only</option>
      </NativeSelect>
      <NativeSelect aria-label="Group spending by" value={params.get("basis") ?? "payment"} onChange={(e) => update({ basis: e.target.value === "payment" ? null : e.target.value })}>
        <option value="payment">By payment date</option>
        <option value="attribution">By month it belongs to</option>
      </NativeSelect>
    </div>
  );
}
