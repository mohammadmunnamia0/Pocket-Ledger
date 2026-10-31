"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  FolderTree,
  HandCoins,
  LayoutDashboard,
  PiggyBank,
  PlusCircle,
  Settings,
  Upload,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/expenses/new", label: "Add Expense", icon: PlusCircle },
  { href: "/income", label: "Income & Salary", icon: Wallet },
  { href: "/categories", label: "Categories", icon: FolderTree },
  { href: "/people", label: "Family & Allocations", icon: Users },
  { href: "/bills", label: "Utility Bills", icon: Zap },
  { href: "/savings", label: "Savings Goals", icon: PiggyBank },
  { href: "/reports", label: "Monthly Reports", icon: BarChart3 },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Pure list — used directly as the Suspense fallback (no active state). */
export function NavList({ active, onNavigate }: { active: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const on = isActive(active, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              on && "bg-muted font-medium text-foreground",
            )}
          >
            <Icon className={cn("size-4", on && "text-primary")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ActiveNav({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList active={usePathname()} onNavigate={onNavigate} />;
}

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-2.5 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <HandCoins className="size-4" aria-hidden />
      </span>
      PocketLedger
    </Link>
  );
}
