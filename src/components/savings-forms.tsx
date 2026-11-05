"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-controls";
import { useAction } from "@/components/use-action";
import { moveSavingsAction, saveGoalAction } from "@/app/actions/ledger";
import { GOAL_KINDS, GOAL_STATUSES, PRIORITIES, type GoalKind, type GoalStatus, type Priority } from "@/lib/constants";
import { GOAL_KIND_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { formatTaka, parseTaka, toInputValue } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/dates";
import type { GoalDTO } from "@/lib/services/savings";

type Account = { id: string; name: string; archived: boolean };

export function GoalDialog({
  trigger,
  goal,
  accounts,
  defaultOpen = false,
  preset,
}: {
  trigger: ReactElement;
  goal?: GoalDTO;
  accounts: Account[];
  defaultOpen?: boolean;
  preset?: GoalKind;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const router = useRouter();
  const { pending, run } = useAction();
  const [name, setName] = useState(goal?.name ?? (preset === "medical" ? "Medical Emergency Fund" : ""));
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? preset ?? "personal");
  const [target, setTarget] = useState(goal ? toInputValue(goal.targetAmount) : preset === "medical" ? "30000" : "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [priority, setPriority] = useState<Priority>(goal?.priority ?? (preset === "medical" ? "high" : "medium"));
  const [monthly, setMonthly] = useState(goal ? toInputValue(goal.monthlyTarget) : "");
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? "active");
  const [accountId, setAccountId] = useState(goal?.accountId ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit savings goal" : "New savings goal"}</DialogTitle>
          <DialogDescription>Money only moves into a goal when you confirm a deposit.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveGoalAction(
                  { name, kind, targetAmount: target, targetDate, priority, monthlyTarget: monthly, status, accountId, description },
                  goal?.id,
                ),
              {
                onSuccess: (id) => {
                  setOpen(false);
                  if (!goal && typeof id === "string") router.push(`/savings/${id}`);
                },
              },
            );
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Goal name" htmlFor="g-name" className="col-span-2">
              <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
            </Field>
            <Field label="Type" htmlFor="g-kind">
              <NativeSelect id="g-kind" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
                {GOAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {GOAL_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Priority" htmlFor="g-priority">
              <NativeSelect id="g-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Target amount (৳)" htmlFor="g-target">
              <Input id="g-target" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" required className="tabular" />
            </Field>
            <Field label="Monthly contribution target (৳)" htmlFor="g-monthly">
              <Input id="g-monthly" value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" placeholder="Optional" className="tabular" />
            </Field>
            <Field label="Target date" htmlFor="g-date">
              <Input id="g-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
            <Field label="Status" htmlFor="g-status">
              <NativeSelect id="g-status" value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
                {GOAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Held in account"
              htmlFor="g-account"
              className="col-span-2"
              hint="Optional. Link a separate savings account so the money is counted there once — never twice."
            >
              <NativeSelect id="g-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Same account it was saved from (earmarked)</option>
                {accounts
                  .filter((a) => !a.archived || a.id === accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Description" htmlFor="g-desc" className="col-span-2">
              <Textarea id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Save goal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deposit to / withdraw from a goal. Two steps — enter, then review and confirm — so
 * money never moves into or out of savings without explicit confirmation.
 */
export function SavingsMoveDialog({
  trigger,
  goal,
  direction,
  accounts,
  spendable,
}: {
  trigger: ReactElement;
  goal: Pick<GoalDTO, "id" | "name" | "balance">;
  direction: "deposit" | "withdraw";
  accounts: Account[];
  spendable: number;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [accountId, setAccountId] = useState(accounts.find((a) => !a.archived)?.id ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const { pending, run } = useAction();
  const deposit = direction === "deposit";
  const poisha = parseTaka(amount) ?? 0;

  function review(e: React.FormEvent) {
    e.preventDefault();
    if (poisha <= 0) return setError("Enter an amount greater than 0");
    if (!deposit && poisha > goal.balance) return setError(`You can withdraw at most ${formatTaka(goal.balance)}`);
    if (!deposit && !notes.trim()) return setError("Add a reason for the withdrawal");
    setError("");
    setStep("review");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setStep("edit");
          setDate(todayISO());
        }
        setOpen(o);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{deposit ? `Add to ${goal.name}` : `Withdraw from ${goal.name}`}</DialogTitle>
          <DialogDescription>
            {deposit
              ? `Moves money from your spendable balance (${formatTaka(spendable)}) into this fund. Not counted as an expense.`
              : `Returns money from this fund (${formatTaka(goal.balance)}) to your spendable balance.`}
          </DialogDescription>
        </DialogHeader>
        {step === "edit" ? (
          <form className="grid gap-4" onSubmit={review}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Amount (৳)" htmlFor="sv-amount">
                <Input id="sv-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required autoFocus className="tabular text-base" />
              </Field>
              <Field label="Date" htmlFor="sv-date">
                <Input id="sv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
            </div>
            <Field label={deposit ? "From account" : "Into account"} htmlFor="sv-account">
              <NativeSelect id="sv-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label={deposit ? "Note" : "Reason"} htmlFor="sv-notes">
              <Textarea id="sv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder={deposit ? "Optional" : "e.g. Doctor visit for Ammar"} />
            </Field>
            {error && <p className="text-sm text-critical">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit">Review</Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-4">
            <dl className="grid gap-2 rounded-lg border p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{deposit ? "Save" : "Withdraw"}</dt>
                <dd className="font-semibold tabular">{formatTaka(poisha)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Date</dt>
                <dd>{formatDate(date)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Fund balance after</dt>
                <dd className="tabular">{formatTaka(goal.balance + (deposit ? poisha : -poisha))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Spendable balance after</dt>
                <dd className="tabular">{formatTaka(spendable + (deposit ? -poisha : poisha))}</dd>
              </div>
            </dl>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("edit")} disabled={pending}>
                <ArrowLeft /> Back
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  run(() => moveSavingsAction({ goalId: goal.id, direction, amount, date, accountId, notes }), {
                    onSuccess: () => {
                      setOpen(false);
                      setAmount("");
                      setNotes("");
                    },
                  })
                }
              >
                {pending && <Loader2 className="animate-spin" />} Confirm {deposit ? "deposit" : "withdrawal"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
