"use client";

import { useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { recordLoanRepaymentAction, saveLoanAction } from "@/app/actions/ledger";
import type { LoanDirection } from "@/lib/constants";
import { formatTaka, toInputValue } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import type { LoanView } from "@/lib/services/loans";

export type AccountChoice = { id: string; name: string; kind: string; archived: boolean; isDefault: boolean };

export function AccountSelect({ id, value, onChange, accounts }: { id: string; value: string; onChange: (v: string) => void; accounts: AccountChoice[] }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
      {accounts
        .filter((a) => !a.archived || a.id === value)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </NativeSelect>
  );
}

export const defaultAccount = (accounts: AccountChoice[]) => (accounts.find((a) => a.isDefault) ?? accounts.find((a) => !a.archived) ?? accounts[0])?.id ?? "";

/** Record a new loan (lent or borrowed), or edit one. */
export function LoanDialog({ trigger, direction, loan, accounts }: { trigger: ReactElement; direction: LoanDirection; loan?: LoanView; accounts: AccountChoice[] }) {
  const lent = direction === "lent";
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const blank = () => ({
    person: loan?.person ?? "",
    amount: loan ? toInputValue(loan.principal) : "",
    date: loan?.date ?? todayISO(),
    dueDate: loan?.dueDate ?? "",
    accountId: loan?.accountId ?? defaultAccount(accounts),
    note: loan?.note ?? "",
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
          <DialogTitle>{loan ? "Edit loan" : lent ? "Lend money" : "Borrow money"}</DialogTitle>
          <DialogDescription>
            {lent
              ? "The money leaves the chosen account and is owed to you — it is not an expense."
              : "The money arrives in the chosen account and you owe it — it is not salary or income."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveLoanAction({ direction, ...f }, loan?.id), {
              onSuccess: () => setOpen(false),
              onError: (x) => setErrors(x.fieldErrors ?? { form: x.error }),
            });
          }}
        >
          <Field label={lent ? "Person (borrower)" : "Lender"} htmlFor="loan-person" error={errors.person}>
            <Input id="loan-person" value={f.person} onChange={(e) => set({ person: e.target.value })} required maxLength={80} autoFocus={!loan} placeholder={lent ? "e.g. Rahim" : "e.g. Karim"} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Amount (৳)" htmlFor="loan-amount" error={errors.amount}>
              <Input id="loan-amount" value={f.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" required className="tabular text-base" />
            </Field>
            <Field label={lent ? "Lending date" : "Borrowing date"} htmlFor="loan-date" error={errors.date}>
              <Input id="loan-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={lent ? "Expected return" : "Expected repayment"} htmlFor="loan-due" error={errors.dueDate} hint="Optional">
              <Input id="loan-due" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
            </Field>
            <Field label={lent ? "Paid from" : "Received in"} htmlFor="loan-account" error={errors.accountId}>
              <AccountSelect id="loan-account" value={f.accountId} onChange={(v) => set({ accountId: v })} accounts={accounts} />
            </Field>
          </div>
          <Field label="Note / purpose" htmlFor="loan-note">
            <Textarea id="loan-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={500} placeholder={lent ? "e.g. Personal loan" : "e.g. Business funding"} />
          </Field>
          {errors.form && <p className="text-sm text-critical">{errors.form}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} {loan ? "Save changes" : lent ? "Record loan" : "Record borrowing"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A partial or full repayment, with optional interest (recorded separately as income / expense). */
export function RepaymentDialog({ trigger, loan, accounts }: { trigger: ReactElement; loan: LoanView; accounts: AccountChoice[] }) {
  const lent = loan.direction === "lent";
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");
  const [date, setDate] = useState("");
  const [accountId, setAccountId] = useState(loan.accountId ?? defaultAccount(accounts));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setAmount(toInputValue(loan.outstanding));
          setInterest("");
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
          <DialogTitle>{lent ? `Repayment from ${loan.person}` : `Repay ${loan.person}`}</DialogTitle>
          <DialogDescription>
            {formatTaka(loan.outstanding)} outstanding. {lent ? "Repaid principal is not income." : "Repaying is not an expense."} Interest is recorded separately
            {lent ? " as income." : " as an expense."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => recordLoanRepaymentAction(loan.id, { amount, interest, date, accountId, note }), {
              onSuccess: () => setOpen(false),
              onError: (x) => setErrors(x.fieldErrors ?? { form: x.error }),
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount repaid (৳)" htmlFor="rp-amount" error={errors.amount}>
              <Input id="rp-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required autoFocus className="tabular text-base" />
            </Field>
            <Field label="Interest (৳)" htmlFor="rp-interest" error={errors.interest} hint="Optional">
              <Input id="rp-interest" value={interest} onChange={(e) => setInterest(e.target.value)} inputMode="decimal" className="tabular text-base" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor="rp-date" error={errors.date}>
              <Input id="rp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label={lent ? "Received in" : "Paid from"} htmlFor="rp-account">
              <AccountSelect id="rp-account" value={accountId} onChange={setAccountId} accounts={accounts} />
            </Field>
          </div>
          <Field label="Note" htmlFor="rp-note">
            <Input id="rp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional" />
          </Field>
          {errors.form && <p className="text-sm text-critical">{errors.form}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Record repayment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
