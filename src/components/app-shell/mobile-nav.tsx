"use client";

import { Suspense, useState, type ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, Handshake, LayoutDashboard, Menu, PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ActiveNav, Brand, NavList } from "./nav";

/** The full menu in a side sheet, opened by `trigger`. */
function NavSheet({ trigger }: { trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="left" className="w-72 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="py-2">
          <Brand showEmail />
        </div>
        <Suspense fallback={<NavList active={null} />}>
          <ActiveNav onNavigate={() => setOpen(false)} />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}

export function MobileNav() {
  return (
    <NavSheet
      trigger={
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      }
    />
  );
}

const TABS = [
  { href: "/personal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/loans", label: "Loans", icon: Handshake },
  { href: "/savings", label: "Savings", icon: PiggyBank },
] as const;

const tabClass = "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:scale-95";

/**
 * Phones: the most used Personal Finance screens one tap away, plus "More" for the full menu.
 * Hidden on the account picker and business pages, whose menus are different.
 */
export function BottomNav() {
  const pathname = usePathname();
  if (!pathname || pathname === "/" || pathname.startsWith("/business/")) return null;
  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t bg-background/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/75 lg:hidden"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const on = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={cn(tabClass, on ? "text-primary" : "text-muted-foreground")}>
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
      <NavSheet
        trigger={
          <button type="button" className={cn(tabClass, "text-muted-foreground")}>
            <Menu className="size-5" aria-hidden />
            More
          </button>
        }
      />
    </nav>
  );
}
