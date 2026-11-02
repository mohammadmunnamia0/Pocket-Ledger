"use client";

import { useState, type ReactElement } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { ConfirmButton } from "@/components/confirm-button";
import { useAction } from "@/components/use-action";
import { deleteBusinessTxnAction, saveBusinessTxnAction, saveInterBusinessAction, setupBusinessAction } from "@/app/actions/business";
import {
  BUSINESS_IN_KINDS,
  BUSINESS_KIND_LABELS,
  BUSINESS_OUT_KINDS,
  INTER_BUSINESS_KINDS,
  INTER_BUSINESS_LABELS,
  directionOf,
  type BusinessTxnKind,
  type InterBusinessKind,
} from "@/lib/business/model";
import type { PeriodMode } from "@/lib/business/period";
import { currentMonth, todayISO } from "@/lib/dates";
import { formatTaka, toInputValue } from "@/lib/money";
import type { BusinessInfo, BusinessTxnView } from "@/lib/services/business";
import { cn } from "@/lib/utils";

type Other = Pick<BusinessInfo, "id" | "name">;

/* ------------------------------------------------------------------ set-up */

/** Identity and opening balance. The opening balance is never assumed — it must be entered. */
export function BusinessSetupForm({ businessKey, initial, onDone }: { businessKey: string; initial: { name: string; type: string; openingBalance?: number; openingDate?: string }; onDone?: () => void }) {
  const { pending, run } = useAction();
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState(initial.type);
  const [opening, setOpening] = useState(initial.openingBalance !== undefined ? toInputValue(initial.openingBalance) : "");
  const [date, setDate] = useState(initial.openingDate ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setupBusinessAction(businessKey, { name, type, openingBalance: opening, openingDate: date }), {
          onSuccess: () => onDone?.(),
          onError: (f) => setErrors(f.fieldErrors ?? { form: f.error }),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name" htmlFor="biz-name" error={errors.name}>
          <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </Field>
        <Field label="Business type" htmlFor="biz-type">
          <Input id="biz-type" value={type} onChange={(e) => setType(e.target.value)} maxLength={80} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Opening balance (৳)"
          htmlFor="biz-opening"
          error={errors.openingBalance}
          hint="Money the business had when these records start. Enter 0 if it started with nothing. Not counted as income or investment."
        >
          <Input id="biz-opening" value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" required className="tabular text-base" />
        </Field>
        <Field label="Records start on" htmlFor="biz-date" error={errors.openingDate} hint="Transactions can't be dated before this.">
          <Input id="biz-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      {errors.form && <p className="text-sm text-critical">{errors.form}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}

export function BusinessSettingsDialog({ trigger, business }: { trigger: ReactElement; business: BusinessInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Business details</DialogTitle>
          <DialogDescription>Renaming keeps every record — transactions belong to the business, not to its name. Changing the opening balance recalculates every running balance.</DialogDescription>
        </DialogHeader>
        {open && <BusinessSetupForm businessKey={business.key} initial={business} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ transactions */

const IN_CHOICES = BUSINESS_IN_KINDS as readonly BusinessTxnKind[];
const OUT_CHOICES = BUSINESS_OUT_KINDS as readonly BusinessTxnKind[];

/** Add a transaction, or edit one. Inter-business transactions are recorded in both businesses at once. */
export function BusinessTxnDialog({
  trigger,
  businessKey,
  businessName,
  others,
  txn,
}: {
  trigger: ReactElement;
  businessKey: string;
  businessName: string;
  others: Other[];
  txn?: BusinessTxnView;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const blank = () => {
    const dir = txn ? directionOf(txn.kind) : ("in" as const);
    return {
      mode: (txn?.linkRef ? "inter" : "money") as "money" | "inter",
      direction: dir,
      kind: (txn && !txn.linkRef ? txn.kind : "owner_investment") as BusinessTxnKind,
      interKind: (txn?.interKind ?? "investment") as InterBusinessKind,
      otherId: txn?.other?.id ?? others[0]?.id ?? "",
      title: txn?.title ?? "",
      amount: txn ? toInputValue(txn.amount) : "",
      date: txn?.date ?? todayISO(),
      party: txn?.party ?? "",
      note: txn?.note ?? "",
      ref: crypto.randomUUID(),
    };
  };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<ReturnType<typeof blank>>) => setF((v) => ({ ...v, ...patch }));
  const other = others.find((o) => o.id === f.otherId);
  const kinds = f.direction === "in" ? IN_CHOICES : OUT_CHOICES;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const done = { onSuccess: () => setOpen(false), onError: (x: { error: string; fieldErrors?: Record<string, string> }) => setErrors(x.fieldErrors ?? { form: x.error }) };
    if (f.mode === "money") {
      run(() => saveBusinessTxnAction(businessKey, { kind: f.kind as never, title: f.title, amount: f.amount, date: f.date, party: f.party, note: f.note }, txn?.id), done);
    } else {
      run(
        () =>
          saveInterBusinessAction(
            businessKey,
            { interKind: f.interKind, direction: f.direction, otherBusinessId: f.otherId, title: f.title, amount: f.amount, date: f.date, note: f.note, ref: txn ? undefined : f.ref },
            txn?.linkRef ?? undefined,
          ),
        done,
      );
    }
  }

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
          <DialogTitle>{txn ? "Edit transaction" : "Add transaction"}</DialogTitle>
          <DialogDescription>Recorded in {businessName} only{f.mode === "inter" ? ` — and its other side in ${other?.name ?? "the other business"}` : ""}.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {!txn && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1 rounded-lg bg-muted p-1 text-sm" role="radiogroup" aria-label="Transaction type">
              {(["money", "inter"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={f.mode === m}
                  onClick={() => set({ mode: m })}
                  className={cn("rounded-md px-2 py-1.5", f.mode === m ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}
                >
                  {m === "money" ? "Money in / out" : "Between businesses"}
                </button>
              ))}
            </div>
          )}

          {f.mode === "money" ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <Field label="Direction" htmlFor="bt-dir">
                <NativeSelect
                  id="bt-dir"
                  value={f.direction}
                  onChange={(e) => {
                    const d = e.target.value as "in" | "out";
                    set({ direction: d, kind: d === "in" ? "owner_investment" : "expense" });
                  }}
                >
                  <option value="in">Money in</option>
                  <option value="out">Money out</option>
                </NativeSelect>
              </Field>
              <Field label="Category" htmlFor="bt-kind" error={errors.kind}>
                <NativeSelect id="bt-kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as BusinessTxnKind })}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {BUSINESS_KIND_LABELS[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : others.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No other business is set up yet. Inter-business transactions become available once another business is set up.</p>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                <Field label="Type" htmlFor="ib-kind">
                  <NativeSelect id="ib-kind" value={f.interKind} onChange={(e) => set({ interKind: e.target.value as InterBusinessKind })}>
                    {INTER_BUSINESS_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {INTER_BUSINESS_LABELS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Other business" htmlFor="ib-other" error={errors.otherBusinessId}>
                  <NativeSelect id="ib-other" value={f.otherId} onChange={(e) => set({ otherId: e.target.value })}>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field label="Money moves" htmlFor="ib-dir">
                <NativeSelect id="ib-dir" value={f.direction} onChange={(e) => set({ direction: e.target.value as "in" | "out" })}>
                  <option value="in">
                    {other?.name ?? "Other business"} → {businessName} (money in)
                  </option>
                  <option value="out">
                    {businessName} → {other?.name ?? "other business"} (money out)
                  </option>
                </NativeSelect>
              </Field>
            </>
          )}

          <Field label={f.mode === "inter" ? "Title (optional)" : "Title"} htmlFor="bt-title" error={errors.title}>
            <Input
              id="bt-title"
              value={f.title}
              onChange={(e) => set({ title: e.target.value })}
              required={f.mode === "money"}
              maxLength={160}
              placeholder={f.mode === "inter" ? `e.g. ${other?.name ?? "ReturnHex"} Investment` : f.direction === "in" ? "e.g. Rakib Investment" : "e.g. Domain Cost"}
            />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <Field label="Amount (৳)" htmlFor="bt-amount" error={errors.amount}>
              <Input id="bt-amount" value={f.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" required className="tabular text-base" />
            </Field>
            <Field label="Date" htmlFor="bt-date" error={errors.date}>
              <Input id="bt-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
            </Field>
          </div>
          {f.mode === "money" && (
            <Field label="Related person or business" htmlFor="bt-party" hint="Optional — e.g. investor, supplier or customer">
              <Input id="bt-party" value={f.party} onChange={(e) => set({ party: e.target.value })} maxLength={80} />
            </Field>
          )}
          <Field label="Note" htmlFor="bt-note">
            <Textarea id="bt-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={1000} placeholder="Optional" />
          </Field>
          {errors.form && <p className="text-sm text-critical">{errors.form}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || (f.mode === "inter" && others.length === 0)}>
              {pending && <Loader2 className="animate-spin" />} {txn ? "Save changes" : "Add transaction"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteBusinessTxnButton({ businessKey, txn }: { businessKey: string; txn: BusinessTxnView }) {
  return (
    <ConfirmButton
      title={`Delete “${txn.title}”?`}
      description={
        txn.linkRef
          ? `This inter-business transaction is removed from both businesses (${txn.other?.name ?? "the other business"} too). Running balances are recalculated.`
          : `Removed from this business only (${formatTaka(txn.amount)}). Running balances are recalculated.`
      }
      action={() => deleteBusinessTxnAction(businessKey, txn.id)}
      variant="ghost"
      size="icon-xs"
    >
      <Trash2 />
      <span className="sr-only">Delete {txn.title}</span>
    </ConfirmButton>
  );
}

/* ------------------------------------------------------------------ date filter */

/** Specific date, range, week or month — kept in the URL so the view can be shared and reloaded. */
export function PeriodFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [mode, setMode] = useState<PeriodMode>((sp.get("period") as PeriodMode) ?? "all");
  const [date, setDate] = useState(sp.get("date") ?? "");
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [month, setMonth] = useState(sp.get("month") ?? "");

  function apply(next: PeriodMode = mode) {
    const q = new URLSearchParams();
    if (next !== "all") q.set("period", next);
    if (next === "date" || next === "week") q.set("date", date || todayISO());
    if (next === "month") q.set("month", month || currentMonth());
    if (next === "range") {
      if (from) q.set("from", from);
      if (to) q.set("to", to);
    }
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <Field label="Show" htmlFor="pf-mode">
        <NativeSelect
          id="pf-mode"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as PeriodMode;
            setMode(m);
            if (m === "all") apply("all");
          }}
        >
          <option value="all">All time</option>
          <option value="date">Specific date</option>
          <option value="week">Week (Sat–Fri)</option>
          <option value="month">Month</option>
          <option value="range">Date range</option>
        </NativeSelect>
      </Field>
      {(mode === "date" || mode === "week") && (
        <Field label={mode === "week" ? "Any day in the week" : "Date"} htmlFor="pf-date">
          <Input id="pf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}
      {mode === "month" && (
        <Field label="Month" htmlFor="pf-month">
          <Input id="pf-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
      )}
      {mode === "range" && (
        <>
          <Field label="From" htmlFor="pf-from">
            <Input id="pf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="pf-to">
            <Input id="pf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </>
      )}
      {mode !== "all" && (
        <Button type="submit" variant="outline">
          Apply
        </Button>
      )}
    </form>
  );
}
