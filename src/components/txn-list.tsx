import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, PiggyBank } from "lucide-react";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/common";
import { formatDate } from "@/lib/dates";
import type { TxnDTO } from "@/lib/services/transactions";
import { TXN_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function txnSign(t: Pick<TxnDTO, "type">): 1 | -1 | 0 {
  if (t.type === "income" || t.type === "savings_withdrawal") return 1;
  if (t.type === "expense" || t.type === "savings_deposit") return -1;
  return 0;
}

export function TxnIcon({ type, className }: { type: TxnDTO["type"]; className?: string }) {
  const Icon =
    type === "income" ? ArrowDownLeft : type === "transfer" ? ArrowLeftRight : type.startsWith("savings") ? PiggyBank : ArrowUpRight;
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground",
        type === "income" && "text-good",
        className,
      )}
      aria-label={TXN_TYPE_LABELS[type]}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

export function TxnAmount({ t, className }: { t: TxnDTO; className?: string }) {
  const sign = txnSign(t);
  return (
    <Money
      value={sign === 0 ? t.amount : sign * t.amount}
      signed={sign > 0}
      tone={sign > 0 ? "income" : t.status === "pending" ? "muted" : "default"}
      className={cn("font-medium", className)}
    />
  );
}

/** Compact transaction list for dashboards and detail pages. */
export function TxnList({ items, showDate = true }: { items: TxnDTO[]; showDate?: boolean }) {
  return (
    <ul className="divide-y">
      {items.map((t) => (
        <li key={t.id}>
          <Link href={`/transactions/${t.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
            <TxnIcon type={t.type} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.incomeLabel || t.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[showDate ? formatDate(t.date) : null, t.categoryLabel ?? TXN_TYPE_LABELS[t.type], t.items.length ? `${t.items.length} items` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <TxnAmount t={t} className="text-sm" />
              {t.status === "pending" && <StatusBadge status="pending" />}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
