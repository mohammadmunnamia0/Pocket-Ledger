"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  FolderTree,
  HandCoins,
  Handshake,
  LayoutDashboard,
  LayoutGrid,
  PiggyBank,
  PlusCircle,
  Settings,
  Store,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HelpButton } from "@/components/help";
import type { HelpKey } from "@/lib/help-content";
import { BUSINESSES } from "@/lib/business/registry";

/** MongoDB database account, shown under the app name in the sidebar as "DB - …". */
export const OWNER_EMAIL = "mohammadmunna4141@gmail.com";

export const NAV_ITEMS = [
  { href: "/", label: "All accounts", icon: LayoutGrid, help: "home" },
  { href: "/personal", label: "Dashboard", icon: LayoutDashboard, help: "dashboard" },
  // One entry per business that is switched on (same accounting screen for each).
  ...BUSINESSES.filter((b) => b.available).map((b) => ({ href: `/business/${b.key}`, label: b.name, icon: Store, help: "business" as const })),
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, help: "transactions" },
  { href: "/expenses/new", label: "Add Expense", icon: PlusCircle, help: "addExpense" },
  { href: "/income", label: "Income & Salary", icon: Wallet, help: "income" },
  { href: "/categories", label: "Categories", icon: FolderTree, help: "categories" },
  { href: "/people", label: "Family & Allocations", icon: Users, help: "people" },
  { href: "/loans", label: "Lending & Borrowing", icon: Handshake, help: "loans" },
  { href: "/investments", label: "Investments", icon: TrendingUp, help: "investments" },
  { href: "/bills", label: "Utility Bills", icon: Zap, help: "bills" },
  { href: "/savings", label: "Savings Goals", icon: PiggyBank, help: "savings" },
  { href: "/reports", label: "Monthly Reports", icon: BarChart3, help: "reports" },
  { href: "/alerts", label: "Alerts", icon: Bell, help: "alerts" },
  { href: "/import", label: "Import", icon: Upload, help: "import" },
  { href: "/settings", label: "Settings", icon: Settings, help: "settings" },
] as const satisfies readonly { href: string; label: string; icon: unknown; help: HelpKey }[];

type NavItem = (typeof NAV_ITEMS)[number];
const isBusinessHref = (href: string) => href.startsWith("/business/");

/**
 * The sidebar shows only the menus of the account you are in, judged from the page:
 * the landing page → just "All accounts"; a business page → that business only;
 * any other page → the Personal Finance menus. Nothing is removed — only shown in context.
 */
export function navItemsFor(pathname: string | null): NavItem[] {
  const home = NAV_ITEMS.filter((i) => i.href === "/");
  if (!pathname || pathname === "/") return home;
  if (pathname.startsWith("/business/")) {
    const key = pathname.split("/")[2];
    return [...home, ...NAV_ITEMS.filter((i) => i.href === `/business/${key}`)];
  }
  return [...home, ...NAV_ITEMS.filter((i) => i.href !== "/" && !isBusinessHref(i.href))];
}

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Pure list — used directly as the Suspense fallback (no active state). */
export function NavList({ active, onNavigate }: { active: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {navItemsFor(active).map(({ href, label, icon: Icon, help }) => {
        const on = isActive(active, href);
        return (
          <div key={href} className="group/nav flex items-center gap-0.5">
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                on && "bg-muted font-medium text-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", on && "text-primary")} aria-hidden />
              <span className="truncate">{label}</span>
            </Link>
            {/* Subtle until hovered on desktop; always visible (faint) on touch screens. */}
            <HelpButton
              topic={help}
              label={`সাহায্য: ${label}`}
              className="opacity-60 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/nav:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            />
          </div>
        );
      })}
    </nav>
  );
}

export function ActiveNav({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList active={usePathname()} onNavigate={onNavigate} />;
}

/** `compact`: the phone header, where every pixel goes to keeping "PocketLedger" readable. */
export function Brand({ showEmail = false, compact = false }: { showEmail?: boolean; compact?: boolean }) {
  return (
    <Link href="/" className={cn("flex min-w-0 items-center gap-2", compact ? "px-1" : "px-2.5")}>
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground", compact && "max-[359px]:hidden")}>
        <HandCoins className="size-4" aria-hidden />
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className={cn("truncate font-semibold tracking-tight", compact && "text-[15px]")}>PocketLedger</span>
        {showEmail && (
          <span className="truncate text-[11px] text-muted-foreground" title={`MongoDB database account: ${OWNER_EMAIL}`}>
            <span className="font-medium">DB - </span>
            {OWNER_EMAIL}
          </span>
        )}
      </span>
    </Link>
  );
}
