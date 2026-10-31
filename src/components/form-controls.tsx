import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/** Native select styled like the inputs — fast, accessible, and mobile-friendly. */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-9 pointer-coarse:h-10 w-full appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base outline-none md:text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-critical" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export interface CategoryChoice {
  id: string;
  name: string;
  parentId: string | null;
  label: string;
}

/** Category <option>s grouped by top-level category. */
export function CategoryOptions({ categories }: { categories: CategoryChoice[] }) {
  const roots = categories.filter((c) => !c.parentId);
  return (
    <>
      {roots.map((root) => {
        const children = categories.filter((c) => c.parentId === root.id);
        return (
          <optgroup key={root.id} label={root.name}>
            <option value={root.id}>{root.name}</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {root.name} › {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}
