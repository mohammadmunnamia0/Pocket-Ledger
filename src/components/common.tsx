import type { ReactNode } from "react";
import { CircleCheck, Clock, Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpButton } from "@/components/help";
import type { HelpKey } from "@/lib/help-content";

export function PageHeader({ title, description, actions, help }: { title: string; description?: string; actions?: ReactNode; help?: HelpKey }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {help && <HelpButton topic={help} label={`সাহায্য: ${title}`} />}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  help,
}: {
  help?: HelpKey;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-card p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && (
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold">{title}</h2>
                {help && <HelpButton topic={help} className="size-5" />}
              </div>
            )}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** A picture of what's missing (transactions, loans, savings…). */
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Paid vs pending — icon + label, never color alone. */
export function StatusBadge({ status }: { status: "paid" | "pending" }) {
  return status === "paid" ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-good">
      <CircleCheck className="size-3.5" aria-hidden /> Paid
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-mark/15 px-2 py-0.5 text-xs font-medium text-warning">
      <Clock className="size-3.5" aria-hidden /> Pending
    </span>
  );
}

export function Meter({ value, max, className, label }: { value: number; max: number; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <CardsSkeleton />
      <TableSkeleton />
    </div>
  );
}
