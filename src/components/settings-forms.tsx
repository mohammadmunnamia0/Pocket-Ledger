"use client";

import { useState, type ReactElement } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { saveAccountAction, rebuildLedgerAction } from "@/app/actions/ledger";
import { changePasswordAction } from "@/app/actions/auth";
import { ACCOUNT_KINDS, type AccountKind } from "@/lib/constants";
import { ACCOUNT_KIND_LABELS } from "@/lib/labels";

export function AccountDialog({ trigger, account }: { trigger: ReactElement; account?: { id: string; name: string; kind: AccountKind } }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "bank");
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{account ? "Edit account" : "New account"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveAccountAction({ name, kind }, account?.id), { onSuccess: () => setOpen(false) });
          }}
        >
          <Field label="Name" htmlFor="acc-name">
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. EBL Savings, bKash" required maxLength={60} />
          </Field>
          <Field label="Type" htmlFor="acc-kind">
            <NativeSelect id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
              {ACCOUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ACCOUNT_KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
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

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const { pending, run } = useAction();
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== confirm) return setError("New passwords don't match");
        setError("");
        run(() => changePasswordAction({ current, next }), {
          onSuccess: () => {
            setCurrent("");
            setNext("");
            setConfirm("");
          },
        });
      }}
    >
      <Field label="Current password" htmlFor="pw-cur">
        <Input id="pw-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </Field>
      <Field label="New password" htmlFor="pw-new">
        <Input id="pw-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirm new password" htmlFor="pw-confirm" error={error}>
        <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Update
      </Button>
    </form>
  );
}

export function RebuildLedgerButton() {
  const [result, setResult] = useState<{ ok: boolean; problems: string[] } | null>(null);
  const { pending, run } = useAction();
  return (
    <div className="grid gap-2">
      <div>
        <Button variant="outline" disabled={pending} onClick={() => run(() => rebuildLedgerAction(), { onSuccess: (r) => setResult(r ?? null) })}>
          {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Rebuild & verify funding ledger
        </Button>
      </div>
      {result && (
        <p className={`text-sm ${result.ok ? "text-good" : "text-critical"}`}>
          {result.ok ? "Verified: every paid expense is fully funded and no salary is over-allocated." : result.problems.join(" · ")}
        </p>
      )}
    </div>
  );
}
