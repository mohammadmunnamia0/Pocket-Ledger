"use client";

import { useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { TransactionForm, type FormDefaults, type FormLookups } from "@/components/transaction-form";
import { useAction } from "@/components/use-action";
import { saveRecurringBillAction } from "@/app/actions/ledger";
import { BILL_TYPES, type BillType } from "@/lib/constants";
import { BILL_TYPE_LABELS } from "@/lib/labels";
import { toInputValue } from "@/lib/money";
import type { RecurringBillDTO } from "@/lib/services/bills";

/** Record a utility bill (paid or pending) through the standard expense form. */
export function BillDialog({
  trigger,
  lookups,
  defaults,
  title = "Record utility bill",
}: {
  trigger: ReactElement;
  lookups: FormLookups;
  defaults: FormDefaults;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>The billing month is stored separately from the payment and recharge dates.</DialogDescription>
        </DialogHeader>
        {open && <TransactionForm mode="expense" lookups={lookups} defaults={defaults} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function RecurringBillDialog({ trigger, bill }: { trigger: ReactElement; bill?: RecurringBillDTO }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const [title, setTitle] = useState(bill?.title ?? "");
  const [billType, setBillType] = useState<BillType>(bill?.billType ?? "internet");
  const [amount, setAmount] = useState(bill ? toInputValue(bill.expectedAmount) : "");
  const [dueDay, setDueDay] = useState(String(bill?.dueDay ?? 10));
  const [active, setActive] = useState(bill?.active ?? true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit recurring bill" : "New recurring bill"}</DialogTitle>
          <DialogDescription>Used for reminders and upcoming-bill estimates. Nothing is deducted until you record the payment.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveRecurringBillAction({ title, billType, expectedAmount: amount, dueDay, active }, bill?.id), {
              onSuccess: () => setOpen(false),
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" htmlFor="rb-title">
              <Input id="rb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Internet (Link3)" required maxLength={80} />
            </Field>
            <Field label="Bill type" htmlFor="rb-type">
              <NativeSelect id="rb-type" value={billType} onChange={(e) => setBillType(e.target.value as BillType)}>
                {BILL_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {BILL_TYPE_LABELS[b]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Expected amount (৳)" htmlFor="rb-amount">
              <Input id="rb-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="tabular" />
            </Field>
            <Field label="Due day of month" htmlFor="rb-day">
              <Input id="rb-day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} required />
            </Field>
          </div>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
            Active (show reminders)
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
