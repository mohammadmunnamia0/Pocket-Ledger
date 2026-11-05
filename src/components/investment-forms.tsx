"use client";

import { useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { AccountSelect, defaultAccount, type AccountChoice } from "@/components/loan-forms";
import { useAction } from "@/components/use-action";
import { recordInvestmentReturnAction, saveInvestmentAction, setInvestmentValueAction } from "@/app/actions/ledger";
import { INVESTMENT_KINDS, type InvestmentKind } from "@/lib/constants";
import { INVESTMENT_KIND_LABELS } from "@/lib/labels";
import { formatTaka, parseTaka, toInputValue } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import type { InvestmentView } from "@/lib/services/investments";

/** Add an investment, or edit one. */
export function InvestmentDialog({ trigger, investment, accounts }: { trigger: ReactElement; investment?: InvestmentView; accounts: AccountChoice[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const blank = () => ({
    name: investment?.name ?? "",
    kind: (investment?.kind ?? "business") as InvestmentKind,
    amount: investment ? toInputValue(investment.invested) : "",
    date: investment?.date ?? todayISO(),
    accountId: investment?.accountId ?? defaultAccount(accounts),
    currentValue: investment?.currentValue != null ? toInputValue(investment.currentValue) : "",
    note: investment?.note ?? "",
  });
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<ReturnType<typeof blank>>) => setF((v) => ({ ...v, ...patch }));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setF(blank());
          setErrors({});
        }
        setOpen(o);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{investment ? "Edit investment" : "Add investment"}</DialogTitle>
          <DialogDescription>The money leaves the chosen account and is kept as an investment — it is not an expense.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveInvestmentAction(f, investment?.id), {
              onSuccess: () => setOpen(false),
              onError: (x) => setErrors(x.fieldErrors ?? { form: x.error }),
            });
          }}
        >
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <Field label="Investment name" htmlFor="inv-name" error={errors.name}>
              <Input id="inv-name" value={f.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} autoFocus={!investment} placeholder="e.g. Business Investment" />
            </Field>
            <Field label="Type" htmlFor="inv-kind">
              <NativeSelect id="inv-kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as InvestmentKind })}>
                {INVESTMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {INVESTMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Amount (৳)" htmlFor="inv-amount" error={errors.amount}>
              <Input id="inv-amount" value={f.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" required className="tabular text-base" />
            </Field>
            <Field label="Date" htmlFor="inv-date" error={errors.date}>
              <Input id="inv-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid from" htmlFor="inv-account" error={errors.accountId}>
              <AccountSelect id="inv-account" value={f.accountId} onChange={(v) => set({ accountId: v })} accounts={accounts} />
            </Field>
            <Field label="Current value (৳)" htmlFor="inv-value" error={errors.currentValue} hint="Optional">
              <Input id="inv-value" value={f.currentValue} onChange={(e) => set({ currentValue: e.target.value })} inputMode="decimal" className="tabular text-base" />
            </Field>
          </div>
          <Field label="Note" htmlFor="inv-note">
            <Textarea id="inv-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={500} placeholder="Optional" />
          </Field>
          {errors.form && <p className="text-sm text-critical">{errors.form}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} {investment ? "Save changes" : "Add investment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Money received from an investment, split into capital returned (not income) and profit (income). */
export function ReturnDialog({ trigger, investment, accounts }: { trigger: ReactElement; investment: InvestmentView; accounts: AccountChoice[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const [capital, setCapital] = useState("");
  const [profit, setProfit] = useState("");
  const [date, setDate] = useState("");
  const [accountId, setAccountId] = useState(investment.accountId ?? defaultAccount(accounts));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const total = (parseTaka(capital || "0") ?? 0) + (parseTaka(profit || "0") ?? 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setCapital("");
          setProfit("");
          setDate(todayISO());
          setNote("");
          setErrors({});
        }
        setOpen(o);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Money back from {investment.name}</DialogTitle>
          <DialogDescription>
            Split it: capital is your own money coming back ({formatTaka(investment.stillInvested)} still invested) — not income. Profit is what you earned on top — income.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => recordInvestmentReturnAction(investment.id, { capital, profit, date, accountId, note }), {
              onSuccess: () => setOpen(false),
              onError: (x) => setErrors(x.fieldErrors ?? { form: x.error }),
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capital returned (৳)" htmlFor="ret-capital" error={errors.capital}>
              <Input id="ret-capital" value={capital} onChange={(e) => setCapital(e.target.value)} inputMode="decimal" autoFocus className="tabular text-base" />
            </Field>
            <Field label="Profit (৳)" htmlFor="ret-profit" error={errors.profit}>
              <Input id="ret-profit" value={profit} onChange={(e) => setProfit(e.target.value)} inputMode="decimal" className="tabular text-base" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor="ret-date" error={errors.date}>
              <Input id="ret-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Received in" htmlFor="ret-account">
              <AccountSelect id="ret-account" value={accountId} onChange={setAccountId} accounts={accounts} />
            </Field>
          </div>
          <Field label="Note" htmlFor="ret-note">
            <Input id="ret-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional" />
          </Field>
          <p className="text-sm text-muted-foreground tabular">Total received: {formatTaka(total)}</p>
          {errors.form && <p className="text-sm text-critical">{errors.form}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Record return
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What the investment is worth now — no money moves. Empty clears it. */
export function ValueDialog({ trigger, investment }: { trigger: ReactElement; investment: InvestmentView }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setValue(investment.currentValue != null ? toInputValue(investment.currentValue) : "");
          setError(null);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Current value</DialogTitle>
          <DialogDescription>What {investment.name} is worth today. Used only for profit / loss — no money moves. Leave empty if unknown.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setInvestmentValueAction(investment.id, value), { onSuccess: () => setOpen(false), onError: (x) => setError(x.error) });
          }}
        >
          <Field label="Value now (৳)" htmlFor="val-now" error={error ?? undefined}>
            <Input id="val-now" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus className="tabular text-base" />
          </Field>
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
