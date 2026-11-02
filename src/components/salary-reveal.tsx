"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Eye } from "lucide-react";
import { formatTaka } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The dashboard's "+ Latest salary" card, private by default: the amount is blurred until
 * the first tap reveals it (in blue); with it showing, a tap opens the salary details as before.
 */
export function SalaryRevealCard({ label, value, hint, href, className }: { label: string; value: number; hint: string; href: string; className?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (shown) return; // already visible: normal navigation
        e.preventDefault();
        setShown(true);
      }}
      aria-label={shown ? undefined : `${label}: hidden. Tap to show the amount.`}
      className={cn("group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20", className)}
    >
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        <ChevronRight className={cn("size-3.5 opacity-0 transition-opacity", shown && "group-hover:opacity-100")} aria-hidden />
      </span>
      <span className="mt-1 text-xl font-semibold tracking-tight tabular">
        {shown ? (
          <span className="text-primary">{formatTaka(value)}</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="pointer-events-none select-none blur-[6px]" aria-hidden>
              {formatTaka(value)}
            </span>
            <Eye className="size-4 text-muted-foreground" aria-hidden />
          </span>
        )}
      </span>
      <span className="mt-1 text-xs text-muted-foreground">{shown ? hint : "Hidden — tap to show"}</span>
    </Link>
  );
}
