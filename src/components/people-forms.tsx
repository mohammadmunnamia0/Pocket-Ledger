"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { recordPaymentAction, saveAllocationAction, savePersonAction } from "@/app/actions/ledger";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/constants";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { toInputValue } from "@/lib/money";
import { currentMonth, todayISO } from "@/lib/dates";

export function PersonDialog({
  trigger,
  person,
}: {
  trigger: ReactElement;
  person?: { id: string; name: string; relation: string | null; monthlyAllocation: number; notes: string | null };
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { pending, run } = useAction();
  const [name, setName] = useState(person?.name ?? "");
  const [relation, setRelation] = useState(person?.relation ?? "");
  const [monthly, setMonthly] = useState(person ? toInputValue(person.monthlyAllocation) : "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{person ? "Edit person" : "Add person"}</DialogTitle>
          <DialogDescription>Track money set aside for and paid to a family member.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => savePersonAction({ name, relation, monthlyAllocation: monthly, notes }, person?.id), {
              onSuccess: (id) => {
                setOpen(false);
                if (!person && typeof id === "string") router.push(`/people/${id}`);
              },
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" htmlFor="p-name">
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
            </Field>
            <Field label="Relation" htmlFor="p-rel">
              <Input id="p-rel" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="e.g. Wife, Mother" maxLength={60} />
            </Field>
          </div>
          <Field label="Usual monthly allocation (৳)" htmlFor="p-monthly" hint="Pre-fills new allocations. Not deducted from your balance.">
            <Input id="p-monthly" value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" placeholder="0" className="tabular" />
          </Field>
          <Field label="Notes" htmlFor="p-notes">
            <Textarea id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AllocationForm({ personId, defaultAmount }: { personId: string; defaultAmount: number }) {
  const { pending, run } = useAction();
  const [month, setMonth] = useState(currentMonth());
  const [amount, setAmount] = useState(defaultAmount ? toInputValue(defaultAmount) : "");
  const [note, setNote] = useState("");
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAllocationAction({ personId, month, amount, note }), { onSuccess: () => setNote("") });
      }}
    >
      <Field label="Month" htmlFor="a-month">
        <Input id="a-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
      </Field>
      <Field label="Amount (৳)" htmlFor="a-amount">
        <Input id="a-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="tabular" />
      </Field>
      <Field label="Note" htmlFor="a-note">
        <Input id="a-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Set allocation
      </Button>
    </form>
  );
}

export function PaymentForm({ personId, personName, months }: { personId: string; personName: string; months: { month: string; remaining: number }[] }) {
  const { pending, run } = useAction();
  const open = months.find((m) => m.remaining > 0);
  const [month, setMonth] = useState(open?.month ?? currentMonth());
  const [amount, setAmount] = useState(open ? toInputValue(open.remaining) : "");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [status, setStatus] = useState<"paid" | "pending">("paid");
  const [notes, setNotes] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => recordPaymentAction({ personId, amount, date, month, paymentMethod: method, status, notes }), {
          success: `Payment to ${personName} recorded`,
          onSuccess: () => {
            setAmount("");
            setNotes("");
          },
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="For month" htmlFor="pay-month">
          <Input id="pay-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </Field>
        <Field label="Amount (৳)" htmlFor="pay-amount">
          <Input id="pay-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="tabular" />
        </Field>
        <Field label="Paid on" htmlFor="pay-date">
          <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Method" htmlFor="pay-method">
          <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field label="Status" htmlFor="pay-status">
          <NativeSelect id="pay-status" value={status} onChange={(e) => setStatus(e.target.value as "paid" | "pending")}>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </NativeSelect>
        </Field>
        <Field label="Note" htmlFor="pay-notes">
          <Input id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Optional" />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Record payment
        </Button>
      </div>
    </form>
  );
}
