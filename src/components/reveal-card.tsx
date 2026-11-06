"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Eye } from "lucide-react";
import { formatTaka } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A taka amount that is blurred until `shown`, then unblurs smoothly (in blue). */
export function PrivateAmount({ value, shown, iconClassName }: { value: number; shown: boolean; iconClassName?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={cn("truncate", shown ? "text-primary" : "private-amount")} aria-hidden={!shown}>
        {formatTaka(value)}
      </span>
      {!shown && <Eye className={cn("size-4 shrink-0 text-muted-foreground", iconClassName)} aria-hidden />}
    </span>
  );
}

/**
 * A link that keeps an amount private: the first tap only reveals it; with it showing, a tap
 * opens `href`. `children` receives whether the amount is shown.
 */
export function RevealLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  /** Read out while hidden: "<label>: hidden. Tap to show the amount." */
  label: string;
  className?: string;
  children: (shown: boolean) => ReactNode;
}) {
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
      className={className}
    >
      {children(shown)}
    </Link>
  );
}

/**
 * A dashboard card that is private by default ("= Remaining balance", "+ Latest salary", Savings,
 * Investment): the amount is blurred until the first tap reveals it; with it showing, a tap
 * opens `href`. `highlight` is the large blue Remaining balance style.
 */
export function RevealCard({
  label,
  value,
  hint,
  href,
  highlight = false,
  className,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <RevealLink
      href={href}
      label={label}
      className={cn(
        "group card-link flex min-w-0 flex-col rounded-xl border bg-card p-4 hover:border-foreground/20",
        highlight && "border-primary/40 bg-primary/5 hover:border-primary/60",
        className,
      )}
    >
      {(shown) => (
        <>
          <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
            {label}
            <ChevronRight className={cn("size-3.5 shrink-0 opacity-0 transition-opacity", shown && "group-hover:opacity-100")} aria-hidden />
          </span>
          <span className={cn("mt-1 font-semibold tracking-tight tabular", highlight ? "text-3xl" : "text-xl")}>
            <PrivateAmount value={value} shown={shown} iconClassName={highlight ? "size-5" : undefined} />
          </span>
          <span className="mt-1 text-xs text-muted-foreground">{shown ? hint : "Hidden — tap to show"}</span>
        </>
      )}
    </RevealLink>
  );
}

/** The "Your accounts" Personal Finance card: Remaining balance private until tapped, then a tap opens the dashboard. */
export function RevealAccountCard({
  href,
  label,
  head,
  value,
  footer,
  className,
}: {
  href: string;
  label: string;
  head: ReactNode;
  value: number;
  /** Shown once the amount is visible (e.g. "Open dashboard"). */
  footer: ReactNode;
  className?: string;
}) {
  return (
    <RevealLink href={href} label={label} className={className}>
      {(shown) => (
        <>
          {head}
          <span className="mt-4 text-xs font-medium text-muted-foreground">{label}</span>
          <span className="text-3xl font-semibold tracking-tight tabular">
            <PrivateAmount value={value} shown={shown} iconClassName="size-5" />
          </span>
          {shown ? footer : <span className="mt-3 text-sm text-muted-foreground">Hidden — tap to show</span>}
        </>
      )}
    </RevealLink>
  );
}
