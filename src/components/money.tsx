import { cn } from "@/lib/utils";
import { formatTaka } from "@/lib/money";

type Tone = "default" | "income" | "expense" | "muted" | "auto";

/** A taka amount. `auto` tone colors negatives critical; income uses the success ink. */
export function Money({
  value,
  tone = "default",
  signed = false,
  className,
}: {
  value: number;
  tone?: Tone;
  signed?: boolean;
  className?: string;
}) {
  const color =
    tone === "income"
      ? "text-good"
      : tone === "muted"
        ? "text-muted-foreground"
        : tone === "auto" && value < 0
          ? "text-critical"
          : "";
  return (
    <span className={cn("tabular whitespace-nowrap", color, className)}>
      {formatTaka(value, { signed })}
    </span>
  );
}
