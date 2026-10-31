"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CategoryOptions, Field, NativeSelect, type CategoryChoice } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { createTransactionAction, updateTransactionAction } from "@/app/actions/ledger";
import { BILL_TYPES, INCOME_KINDS, PAYMENT_METHODS, type BillType, type IncomeKind, type PaymentMethod } from "@/lib/constants";
import { BILL_TYPE_LABELS, INCOME_KIND_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatTaka, parseTaka, toInputValue } from "@/lib/money";
import { formatDate, formatMonthLong } from "@/lib/dates";
import type { TxnDTO } from "@/lib/services/transactions";
import type { TxnInputRaw } from "@/lib/validation";

export interface FormLookups {
  categories: CategoryChoice[];
  accounts: { id: string; name: string; archived: boolean; isDefault: boolean }[];
  persons: { id: string; name: string; archived: boolean }[];
  incomes?: { id: string; label: string; date: string; amount: number }[];
}

export interface FormDefaults {
  date: string;
  categoryId?: string | null;
  paymentMethod?: PaymentMethod;
  accountId?: string | null;
  bill?: { billType: BillType; month: string; amount?: number; title?: string; recurringBillId?: string } | null;
  incomeKind?: IncomeKind;
}

interface Item {
  key: number;
  name: string;
  amount: string;
  categoryId: string;
  notes: string;
}

let itemKey = 0;
const newItem = (p: Partial<Item> = {}): Item => ({ key: ++itemKey, name: "", amount: "", categoryId: "", notes: "", ...p });

export function TransactionForm({
  mode,
  lookups,
  defaults,
  initial,
  redirectTo,
  onDone,
}: {
  mode: "expense" | "income" | "transfer";
  lookups: FormLookups;
  defaults: FormDefaults;
  initial?: TxnDTO;
  redirectTo?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const accounts = lookups.accounts.filter((a) => !a.archived || a.id === initial?.accountId || a.id === initial?.toAccountId);
  const defaultAccount = defaults.accountId ?? lookups.accounts.find((a) => a.isDefault)?.id ?? "";

  const [title, setTitle] = useState(initial?.title ?? defaults.bill?.title ?? "");
  const [amount, setAmount] = useState(initial ? toInputValue(initial.amount) : defaults.bill?.amount ? toInputValue(defaults.bill.amount) : "");
  const [date, setDate] = useState(initial?.date ?? defaults.date);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? defaults.categoryId ?? "");
  const [status, setStatus] = useState<"paid" | "pending">(initial?.status ?? "paid");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial?.paymentMethod ?? defaults.paymentMethod ?? "cash");
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaultAccount);
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? "");
  const [personId, setPersonId] = useState(initial?.personId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [attributionMonth, setAttributionMonth] = useState(
    initial && initial.attributionMonth !== initial.date.slice(0, 7) ? initial.attributionMonth : (defaults.bill?.month ?? ""),
  );
  const [incomeKind, setIncomeKind] = useState<IncomeKind>(initial?.incomeKind ?? defaults.incomeKind ?? "salary");
  const [incomeLabel, setIncomeLabel] = useState(initial?.incomeLabel ?? "");
  const [fundingSourceId, setFundingSourceId] = useState(initial?.fundingSourceId ?? "");

  const [useBreakdown, setUseBreakdown] = useState((initial?.items.length ?? 0) > 0);
  const [items, setItems] = useState<Item[]>(
    initial?.items.length
      ? initial.items.map((i) => newItem({ name: i.name, amount: toInputValue(i.amount), categoryId: i.categoryId ?? "", notes: i.notes ?? "" }))
      : [newItem(), newItem()],
  );

  const [isBill, setIsBill] = useState(!!initial?.bill || !!defaults.bill);
  const [billType, setBillType] = useState<BillType>(initial?.bill?.billType ?? defaults.bill?.billType ?? "internet");
  const [rechargeDate, setRechargeDate] = useState(initial?.bill?.rechargeDate ?? "");
  const [coverageFrom, setCoverageFrom] = useState(initial?.bill?.coverageFrom ?? "");
  const [coverageTo, setCoverageTo] = useState(initial?.bill?.coverageTo ?? "");

  const breakdownTotal = useMemo(() => items.reduce((s, i) => s + Math.max(0, parseTaka(i.amount) ?? 0), 0), [items]);
  const salaryMonth = attributionMonth || date.slice(0, 7);

  function updateItem(key: number, patch: Partial<Item>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const filledItems = items.filter((i) => i.name.trim() || i.amount.trim());
    const payload: TxnInputRaw = {
      type: mode,
      title: mode === "income" && !title.trim() ? incomeLabel || `${formatMonthLong(salaryMonth)} ${INCOME_KIND_LABELS[incomeKind]}` : title,
      amount: mode === "expense" && useBreakdown ? undefined : amount,
      date,
      attributionMonth: attributionMonth || undefined,
      paymentMethod,
      accountId: accountId || undefined,
      notes,
    };
    if (mode === "expense") {
      Object.assign(payload, {
        categoryId: categoryId || undefined,
        status,
        personId: personId || undefined,
        fundingSourceId: fundingSourceId || undefined,
        items: useBreakdown
          ? filledItems.map((i) => ({ name: i.name, amount: i.amount, categoryId: i.categoryId || undefined, notes: i.notes || undefined }))
          : [],
        bill: isBill
          ? {
              billType,
              rechargeDate: rechargeDate || undefined,
              coverageFrom: coverageFrom || undefined,
              coverageTo: coverageTo || undefined,
              recurringBillId: initial?.bill?.recurringBillId ?? defaults.bill?.recurringBillId,
            }
          : null,
      });
      if (useBreakdown && filledItems.length === 0) {
        setErrors({ items: "Add at least one breakdown item" });
        return;
      }
    }
    if (mode === "income") Object.assign(payload, { incomeKind, incomeLabel: incomeLabel || undefined });
    if (mode === "transfer") Object.assign(payload, { toAccountId: toAccountId || undefined, title: title || "Transfer between accounts" });

    setErrors({});
    run<unknown>(() => (initial ? updateTransactionAction(initial.id, payload) : createTransactionAction(payload)), {
      onSuccess: () => {
        if (onDone) onDone();
        else if (redirectTo) router.push(redirectTo);
        if (!initial && !onDone && !redirectTo) {
          setTitle("");
          setAmount("");
          setNotes("");
          setItems([newItem(), newItem()]);
        }
      },
      onError: (f) => setErrors(f.fieldErrors ?? {}),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      {mode === "income" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Income type" htmlFor="incomeKind">
            <NativeSelect id="incomeKind" value={incomeKind} onChange={(e) => setIncomeKind(e.target.value as IncomeKind)}>
              {INCOME_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INCOME_KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Label"
            htmlFor="incomeLabel"
            hint={`Shown in salary records. Default: “${formatMonthLong(salaryMonth)} ${INCOME_KIND_LABELS[incomeKind]}”`}
          >
            <Input id="incomeLabel" value={incomeLabel} onChange={(e) => setIncomeLabel(e.target.value)} placeholder={`${formatMonthLong(salaryMonth)} Salary`} maxLength={80} />
          </Field>
        </div>
      )}

      {mode !== "income" && (
        <Field label={mode === "transfer" ? "Description" : "Title"} htmlFor="title" error={errors.title}>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === "transfer" ? "e.g. ATM withdrawal" : "e.g. Chicken, Internet Bill, বাজার"}
            maxLength={160}
            required={mode === "expense"}
            autoFocus={!initial}
          />
        </Field>
      )}

      {mode === "expense" && (
        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Itemized breakdown</p>
            <p className="text-xs text-muted-foreground">Split one payment into items. The total is calculated from the items.</p>
          </div>
          <Switch checked={useBreakdown} onCheckedChange={setUseBreakdown} aria-label="Itemized breakdown" />
        </div>
      )}

      {mode === "expense" && useBreakdown ? (
        <div className="grid gap-2">
          <div className="hidden grid-cols-[1fr_8rem_12rem_2rem] gap-2 px-1 text-xs text-muted-foreground sm:grid">
            <span>Item</span>
            <span>Amount (৳)</span>
            <span>Category (optional)</span>
          </div>
          {items.map((item, idx) => (
            <div key={item.key} className="grid grid-cols-[1fr_7rem_2rem] gap-2 sm:grid-cols-[1fr_8rem_12rem_2rem]">
              <Input
                aria-label={`Item ${idx + 1} name`}
                value={item.name}
                onChange={(e) => updateItem(item.key, { name: e.target.value })}
                placeholder="Item name"
                maxLength={120}
              />
              <Input
                aria-label={`Item ${idx + 1} amount`}
                value={item.amount}
                onChange={(e) => updateItem(item.key, { amount: e.target.value })}
                inputMode="decimal"
                placeholder="0"
                className="tabular"
              />
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                <NativeSelect aria-label={`Item ${idx + 1} category`} value={item.categoryId} onChange={(e) => updateItem(item.key, { categoryId: e.target.value })}>
                  <option value="">Same as parent</option>
                  <CategoryOptions categories={lookups.categories} />
                </NativeSelect>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="mt-0.5 sm:mt-0.5"
                aria-label={`Remove item ${idx + 1}`}
                onClick={() => setItems((l) => (l.length > 1 ? l.filter((i) => i.key !== item.key) : l))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setItems((l) => [...l, newItem()])}>
              <Plus /> Add item
            </Button>
            <p className="text-sm">
              Total <span className="tabular font-semibold">{formatTaka(breakdownTotal)}</span>
            </p>
          </div>
          {(errors.items || errors.amount) && <p className="text-xs text-critical">{errors.items || errors.amount}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Amount (৳)" htmlFor="amount" error={errors.amount}>
            <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" required className="tabular text-base" />
          </Field>
          <Field label={mode === "income" ? "Received date" : status === "pending" ? "Due date" : "Date"} htmlFor="date" error={errors.date}>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
      )}

      {mode === "expense" && useBreakdown && (
        <Field label={status === "pending" ? "Due date" : "Date"} htmlFor="date" error={errors.date} className="sm:max-w-[50%]">
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      )}

      {mode === "expense" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="category" error={errors.categoryId}>
            <NativeSelect id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Others</option>
              <CategoryOptions categories={lookups.categories} />
            </NativeSelect>
          </Field>
          <Field label="Payment status" htmlFor="status">
            <NativeSelect id="status" value={status} onChange={(e) => setStatus(e.target.value as "paid" | "pending")}>
              <option value="paid">Paid — deduct from balance</option>
              <option value="pending">Pending — not deducted yet</option>
            </NativeSelect>
          </Field>
        </div>
      )}

      {mode === "transfer" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="From account" htmlFor="fromAccount">
            <NativeSelect id="fromAccount" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="To account" htmlFor="toAccount" error={errors.toAccountId}>
            <NativeSelect id="toAccount" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Payment method" htmlFor="method">
            <NativeSelect id="method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={mode === "income" ? "Received into" : "Paid from"} htmlFor="account">
            <NativeSelect id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={mode === "income" ? "Salary month" : "Belongs to month"}
            htmlFor="month"
            hint={mode === "income" ? "Defaults to the received month" : "Optional — e.g. November's bill paid in October"}
            error={errors.attributionMonth}
          >
            <Input id="month" type="month" value={attributionMonth} onChange={(e) => setAttributionMonth(e.target.value)} />
          </Field>
        </div>
      )}

      {mode === "expense" && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Related person (optional)" htmlFor="person" hint="Links this payment to a family member's allocation">
              <NativeSelect id="person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">None</option>
                {lookups.persons
                  .filter((p) => !p.archived || p.id === personId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            {lookups.incomes && lookups.incomes.length > 0 && (
              <Field label="Fund from salary (optional)" htmlFor="funding" hint="Default: oldest salary with money left (FIFO)">
                <NativeSelect id="funding" value={fundingSourceId} onChange={(e) => setFundingSourceId(e.target.value)}>
                  <option value="">Automatic (FIFO)</option>
                  {lookups.incomes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} · {formatDate(s.date)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>

          <div className="rounded-lg border">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Utility bill details</p>
                <p className="text-xs text-muted-foreground">Track bill type, recharge date and coverage period</p>
              </div>
              <Switch checked={isBill} onCheckedChange={setIsBill} aria-label="Utility bill details" />
            </div>
            {isBill && (
              <div className="grid gap-4 border-t p-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Bill type" htmlFor="billType">
                  <NativeSelect id="billType" value={billType} onChange={(e) => setBillType(e.target.value as BillType)}>
                    {BILL_TYPES.map((b) => (
                      <option key={b} value={b}>
                        {BILL_TYPE_LABELS[b]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Recharge date" htmlFor="recharge">
                  <Input id="recharge" type="date" value={rechargeDate} onChange={(e) => setRechargeDate(e.target.value)} />
                </Field>
                <Field label="Coverage from" htmlFor="covFrom">
                  <Input id="covFrom" type="date" value={coverageFrom} onChange={(e) => setCoverageFrom(e.target.value)} />
                </Field>
                <Field label="Coverage to" htmlFor="covTo" error={errors["bill.coverageTo"]}>
                  <Input id="covTo" type="date" value={coverageTo} onChange={(e) => setCoverageTo(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        </>
      )}

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Optional — English or বাংলা" />
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {(redirectTo || onDone) && (
          <Button type="button" variant="ghost" onClick={() => (onDone ? onDone() : router.back())} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending} size="lg">
          {pending && <Loader2 className="animate-spin" />}
          {initial ? "Save changes" : mode === "income" ? "Add income" : mode === "transfer" ? "Record transfer" : "Add expense"}
        </Button>
      </div>
    </form>
  );
}
