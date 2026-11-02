"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmButton } from "@/components/confirm-button";
import { useAction } from "@/components/use-action";
import { deleteTransactionAction, markPaidAction } from "@/app/actions/ledger";
import { todayISO } from "@/lib/dates";
import { offlineDelete, saveWithFallback, savedOnDevice } from "@/lib/offline/hooks";

export function DeleteTxnButton({
  id,
  title,
  redirectTo,
  iconOnly = false,
  updatedAt,
}: {
  id: string;
  title: string;
  /** Version the user is looking at — lets the delete be queued safely while offline. */
  updatedAt?: string;
  redirectTo?: string;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  return (
    <ConfirmButton
      title={`Delete “${title}”?`}
      description="This permanently removes the transaction. All balances, salary funding and reports are recalculated. Deleting income that already funded expenses is refused."
      action={() =>
        updatedAt
          ? saveWithFallback(() => deleteTransactionAction(id), () => offlineDelete({ id, updatedAt, title }))
          : deleteTransactionAction(id)
      }
      onDone={() => redirectTo && (savedOnDevice() ? window.location.assign(redirectTo) : router.push(redirectTo))}
      variant={iconOnly ? "ghost" : "destructive"}
      size={iconOnly ? "icon-xs" : "sm"}
    >
      <Trash2 />
      {iconOnly ? <span className="sr-only">Delete</span> : "Delete"}
    </ConfirmButton>
  );
}

/** Mark a pending expense as paid, choosing the actual payment date. */
export function MarkPaidButton({ id, dueDate, size = "sm" }: { id: string; dueDate: string; size?: "sm" | "xs" }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(dueDate);
  const { pending, run } = useAction();
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDate(todayISO() < dueDate ? todayISO() : dueDate);
        setOpen(o);
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size={size} />}>
        <CheckCircle2 /> Mark paid
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => markPaidAction(id, date), { onSuccess: () => setOpen(false) });
          }}
        >
          <label htmlFor={`paid-${id}`} className="text-xs font-medium text-muted-foreground">
            Payment date
          </label>
          <Input id={`paid-${id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <p className="text-xs text-muted-foreground">The amount will be deducted and funded from your salaries (FIFO).</p>
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Confirm payment
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
