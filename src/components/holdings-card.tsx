"use client";

import { useState } from "react";
import { ArrowLeftRight, Landmark, Loader2, Smartphone, SlidersHorizontal, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { HelpButton } from "@/components/help";
import { Money } from "@/components/money";
import { useAction } from "@/components/use-action";
import { createTransactionAction, setHoldingsAction } from "@/app/actions/ledger";
import { newSaveId, offlineCreate, saveWithFallback } from "@/lib/offline/hooks";
import { HOLDING_KINDS, type HoldingKind } from "@/lib/constants";
import { HOLDING_LABELS } from "@/lib/labels";
import { formatTaka, parseTaka, toInputValue } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import type { Holdings } from "@/lib/services/holdings";
import { cn } from "@/lib/utils";

const ICONS: Record<HoldingKind, typeof Wallet> = { bank: Landmark, cash: Wallet, mobile: Smartphone };

/** Bank / Cash / Mobile Banking boxes under the Remaining balance card. */
export function HoldingsStrip({ holdings, remaining }: { holdings: Holdings; remaining: number }) {
  // Money set aside in savings goals stays in its account but isn't spendable, so the two can differ.
  const gap = holdings.total + holdings.other - remaining;
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 sm:p-4" aria-labelledby="holdings-title">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id="holdings-title" className="text-xs font-medium text-muted-foreground">
          Where the remaining balance is kept
        </h3>
        <HelpButton topic="holdings" className="size-5" />
        <div className="ml-auto flex gap-1.5">
          <MoveMoneyDialog holdings={holdings} />
          <SplitDialog holdings={holdings} />
        </div>
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {holdings.items.map((h) => {
          const Icon = ICONS[h.kind];
          return (
            <li key={h.kind} className="min-w-0 rounded-lg border bg-card p-2.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{h.label}</span>
              </span>
              <span className="mt-0.5 block truncate text-base font-semibold tracking-tight sm:text-lg">
                <Money value={h.amount} tone="auto" />
              </span>
              {h.note && (
                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground" title={h.note}>
                  {h.note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className={cn("mt-2 text-xs", gap === 0 ? "text-muted-foreground" : "text-warning")} role={gap === 0 ? undefined : "status"}>
        {gap === 0
          ? `Bank + Cash + Mobile Banking = ${formatTaka(holdings.total)} — matches the remaining balance.`
          : holdings.other !== 0
            ? `These add up to ${formatTaka(holdings.total)}; ${formatTaka(holdings.other)} more is in other accounts (card / savings). Together they differ from the remaining balance by ${formatTaka(Math.abs(gap))}${gap > 0 ? " — money set aside in savings goals stays in its account." : "."}`
            : `These add up to ${formatTaka(holdings.total)}, ${formatTaka(Math.abs(gap))} ${gap > 0 ? "more" : "less"} than the remaining balance${gap > 0 ? " — money set aside in savings goals stays in its account but isn't spendable." : ". Check for a missing or wrongly-recorded entry."}`}
      </p>
    </div>
  );
}

function SplitDialog({ holdings }: { holdings: Holdings }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const initial = () => Object.fromEntries(holdings.items.map((h) => [h.kind, { amount: toInputValue(Math.max(0, h.amount)), note: h.note ?? "" }])) as Record<HoldingKind, { amount: string; note: string }>;
  const [values, setValues] = useState(initial);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const entered = HOLDING_KINDS.reduce((s, k) => s + (parseTaka(values[k].amount || "0") ?? 0), 0);
  const diff = entered - holdings.total;
  const set = (k: HoldingKind, patch: Partial<{ amount: string; note: string }>) => setValues((v) => ({ ...v, [k]: { ...v[k], ...patch } }));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setValues(initial());
          setDate(todayISO());
          setError(null);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger render={<Button size="xs" variant="outline" />}>
        <SlidersHorizontal /> Change split
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Where is your money kept?</DialogTitle>
          <DialogDescription>
            Enter how much is in each place now. The total must stay {formatTaka(holdings.total)} — the differences are saved as transfers between your
            accounts, never as income or expense.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            run(() => setHoldingsAction({ date, holdings: HOLDING_KINDS.map((k) => ({ kind: k, amount: values[k].amount || "0", note: values[k].note })) }), {
              onSuccess: () => setOpen(false),
              onError: (f) => setError(f.error),
            });
          }}
        >
          {HOLDING_KINDS.map((k) => (
            <fieldset key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
              <legend className="sr-only">{HOLDING_LABELS[k]}</legend>
              <Field label={`${HOLDING_LABELS[k]} (৳)`} htmlFor={`hold-${k}`}>
                <Input id={`hold-${k}`} value={values[k].amount} onChange={(e) => set(k, { amount: e.target.value })} inputMode="decimal" className="tabular text-base" />
              </Field>
              <Field label="Note / purpose" htmlFor={`hold-${k}-note`}>
                <Input id={`hold-${k}-note`} value={values[k].note} onChange={(e) => set(k, { note: e.target.value })} maxLength={200} placeholder="Optional" />
              </Field>
            </fieldset>
          ))}
          <Field label="Date of the moves" htmlFor="hold-date">
            <Input id="hold-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <p className={cn("rounded-lg border px-3 py-2 text-sm tabular", diff === 0 ? "text-muted-foreground" : "border-critical/40 text-critical")} aria-live="polite">
            Total {formatTaka(entered)} {diff === 0 ? "✓ matches" : `— ${formatTaka(Math.abs(diff))} ${diff > 0 ? "too much" : "missing"} (must be ${formatTaka(holdings.total)})`}
          </p>
          {error && <p className="text-sm text-critical">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || diff !== 0}>
              {pending && <Loader2 className="animate-spin" />} Save split
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveMoneyDialog({ holdings }: { holdings: Holdings }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const [from, setFrom] = useState<HoldingKind>("bank");
  const [to, setTo] = useState<HoldingKind>("cash");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const accountOf = (k: HoldingKind) => holdings.items.find((h) => h.kind === k)?.accountId ?? undefined;
  const available = holdings.items.find((h) => h.kind === from)?.amount ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setDate(todayISO());
          setErrors({});
        }
        setOpen(o);
      }}
    >
      <DialogTrigger render={<Button size="xs" variant="outline" />}>
        <ArrowLeftRight /> Move money
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move money</DialogTitle>
          <DialogDescription>For example cash taken out of the bank. The total stays the same — not income or expense.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (from === to) return setErrors({ toAccountId: "Choose two different places" });
            const payload = {
              type: "transfer" as const,
              title: `${HOLDING_LABELS[from]} → ${HOLDING_LABELS[to]}`,
              amount,
              date,
              accountId: accountOf(from),
              toAccountId: accountOf(to),
              notes: note,
            };
            const clientRef = newSaveId();
            run(() => saveWithFallback(() => createTransactionAction(payload, clientRef), () => offlineCreate(payload, clientRef)), {
              success: `Moved ${formatTaka(parseTaka(amount) ?? 0)} from ${HOLDING_LABELS[from]} to ${HOLDING_LABELS[to]}`,
              onSuccess: () => {
                setOpen(false);
                setAmount("");
                setNote("");
              },
              onError: (f) => setErrors(f.fieldErrors ?? {}),
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="mv-from" hint={`Has ${formatTaka(available)}`}>
              <NativeSelect id="mv-from" value={from} onChange={(e) => setFrom(e.target.value as HoldingKind)}>
                {HOLDING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {HOLDING_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="To" htmlFor="mv-to" error={errors.toAccountId}>
              <NativeSelect id="mv-to" value={to} onChange={(e) => setTo(e.target.value as HoldingKind)}>
                {HOLDING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {HOLDING_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (৳)" htmlFor="mv-amount" error={errors.amount}>
              <Input id="mv-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="tabular text-base" />
            </Field>
            <Field label="Date" htmlFor="mv-date" error={errors.date}>
              <Input id="mv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
          <Field label="Note" htmlFor="mv-note">
            <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional, e.g. ATM withdrawal" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Move
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
