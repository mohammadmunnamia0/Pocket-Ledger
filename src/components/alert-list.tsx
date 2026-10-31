"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { alertStateAction } from "@/app/actions/ledger";
import { useAction } from "@/components/use-action";
import { formatTaka } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ShownAlert } from "@/lib/services/alerts";

const PRIORITY_STYLE = {
  high: { label: "High", className: "border-l-critical-mark" },
  medium: { label: "Medium", className: "border-l-warning-mark" },
  low: { label: "Low", className: "border-l-good-mark" },
} as const;

export function AlertList({ alerts }: { alerts: ShownAlert[] }) {
  const { pending, run } = useAction();
  return (
    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {alerts.map((a) => (
        <li
          key={a.key}
          className={cn("rounded-lg border border-l-4 bg-card p-3", PRIORITY_STYLE[a.priority].className, a.read && "opacity-70")}
        >
          <div className="flex items-start gap-2.5">
            <span className="text-lg leading-none" aria-hidden>
              {a.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium">
                  {a.title}
                  <span className="ml-2 align-middle text-[10px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase">
                    {PRIORITY_STYLE[a.priority].label} priority
                  </span>
                </p>
                <div className="-mt-1 -mr-1 flex shrink-0 gap-0.5">
                  {!a.read && (
                    <Button variant="ghost" size="icon-xs" disabled={pending} aria-label="Mark as read" onClick={() => run(() => alertStateAction(a.key, "read"), { success: false })}>
                      <Check />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-xs" disabled={pending} aria-label="Dismiss" onClick={() => run(() => alertStateAction(a.key, "dismiss"), { success: "Alert dismissed" })}>
                    <X />
                  </Button>
                </div>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{a.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {a.amount !== undefined && <span className="tabular text-xs font-medium">{formatTaka(a.amount)}</span>}
                {a.action && (
                  <Link
                    href={a.action.href}
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => !a.read && run(() => alertStateAction(a.key, "read"), { success: false })}
                  >
                    {a.action.label} →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
