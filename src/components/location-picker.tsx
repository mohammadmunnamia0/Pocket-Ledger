"use client";

import { Landmark, Smartphone, Wallet } from "lucide-react";
import { HOLDING_KINDS, type HoldingKind, type PaymentMethod } from "@/lib/constants";
import { HOLDING_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type PickerAccount = { id: string; name: string; kind: string; archived: boolean };

const ICONS: Record<HoldingKind, typeof Wallet> = { bank: Landmark, cash: Wallet, mobile: Smartphone };

/**
 * The account that represents Bank / Cash / Mobile Banking — the same one the Remaining
 * balance boxes show (first active account of that kind, default account first).
 */
export function holdingAccountId(accounts: PickerAccount[], kind: HoldingKind): string | undefined {
  return (accounts.find((a) => a.kind === kind && !a.archived) ?? accounts.find((a) => a.kind === kind))?.id;
}

/** Which of the three places an account belongs to (null for card / savings / other accounts). */
export function holdingKindOf(accounts: PickerAccount[], accountId: string | null | undefined): HoldingKind | null {
  const kind = accounts.find((a) => a.id === accountId)?.kind;
  return (HOLDING_KINDS as readonly string[]).includes(kind ?? "") ? (kind as HoldingKind) : null;
}

/** The payment method recorded with an expense paid from / income kept in this place. */
export const methodFor = (kind: HoldingKind): PaymentMethod => kind;

/**
 * Bank · Cash · Mobile Banking — where an expense is paid from, or where money is kept.
 * Picking a place deducts from / adds to that place only.
 */
export function LocationPicker({
  id,
  label,
  value,
  onChange,
  accounts,
}: {
  id: string;
  label: string;
  value: HoldingKind | null;
  onChange: (kind: HoldingKind) => void;
  accounts: PickerAccount[];
}) {
  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-3 gap-1.5">
        {HOLDING_KINDS.map((k) => {
          const Icon = ICONS[k];
          const on = value === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!holdingAccountId(accounts, k)}
              onClick={() => onChange(k)}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm transition-colors disabled:opacity-40",
                on ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{HOLDING_LABELS[k]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
