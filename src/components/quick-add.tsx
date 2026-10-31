"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CategoryOptions, Field, NativeSelect, type CategoryChoice } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { HelpButton } from "@/components/help";
import { createTransactionAction } from "@/app/actions/ledger";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/constants";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { todayISO } from "@/lib/dates";

/**
 * The fast path for daily expenses: five fields, keyboard friendly. Category and payment
 * method default to the last ones used (stored server-side) and stick between entries.
 */
export function QuickAdd({
  categories,
  persons,
  lastCategoryId,
  lastPaymentMethod,
}: {
  categories: CategoryChoice[];
  persons: { id: string; name: string }[];
  lastCategoryId: string | null;
  lastPaymentMethod: PaymentMethod;
}) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState(lastCategoryId ?? "");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(lastPaymentMethod);
  const [status, setStatus] = useState<"paid" | "pending">("paid");
  const [personId, setPersonId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useAction();

  function onOpenChange(next: boolean) {
    // The date is computed on open (Dhaka time), never during render.
    if (next) setDate(todayISO());
    setOpen(next);
  }

  function submit(e: React.FormEvent, keepOpen = false) {
    e.preventDefault();
    run(
      () =>
        createTransactionAction({
          type: "expense",
          title,
          amount,
          date,
          categoryId: categoryId || undefined,
          notes,
          paymentMethod: method,
          status,
          personId: personId || undefined,
        }),
      {
        success: `Added “${title}”`,
        onSuccess: () => {
          setTitle("");
          setAmount("");
          setNotes("");
          setErrors({});
          if (!keepOpen) setOpen(false);
        },
        onError: (f) => setErrors(f.fieldErrors ?? {}),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="lg" aria-label="Quick Add expense" />}>
        <Plus /> <span className="min-[400px]:hidden">Add</span>
        <span className="hidden min-[400px]:inline">Quick Add</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1">
            Add expense <HelpButton topic="quickAdd" />
          </DialogTitle>
          <DialogDescription>Deducted from your balance using the oldest salary first.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => submit(e)} className="grid gap-4">
          <Field label="Title" htmlFor="qa-title" error={errors.title}>
            <Input id="qa-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chicken, Transport, ওষুধ" required autoFocus maxLength={160} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (৳)" htmlFor="qa-amount" error={errors.amount}>
              <Input id="qa-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" required className="tabular text-base" />
            </Field>
            <Field label="Date" htmlFor="qa-date" error={errors.date}>
              <Input id="qa-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
          <Field label="Category" htmlFor="qa-category">
            <NativeSelect id="qa-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Others</option>
              <CategoryOptions categories={categories} />
            </NativeSelect>
          </Field>
          <Field label="Notes" htmlFor="qa-notes">
            <Textarea id="qa-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" maxLength={2000} />
          </Field>

          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={more}
          >
            <ChevronDown className={`size-3.5 transition-transform ${more ? "rotate-180" : ""}`} aria-hidden />
            More options
          </button>
          {more && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment method" htmlFor="qa-method">
                <NativeSelect id="qa-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Status" htmlFor="qa-status">
                <NativeSelect id="qa-status" value={status} onChange={(e) => setStatus(e.target.value as "paid" | "pending")}>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                </NativeSelect>
              </Field>
              {persons.length > 0 && (
                <Field label="Related person" htmlFor="qa-person" className="col-span-2">
                  <NativeSelect id="qa-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                    <option value="">None</option>
                    {persons.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={pending} onClick={(e) => submit(e as unknown as React.FormEvent, true)}>
              Save &amp; add another
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Add expense
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
