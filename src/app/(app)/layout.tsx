import { Suspense } from "react";
import { Bell, LogOut, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveNav, Brand, NavList } from "@/components/app-shell/nav";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { QuickAdd } from "@/components/quick-add";
import { InstallAppButton } from "@/components/pwa";
import { AlertBell } from "@/components/alert-bell";
import { getActiveAlerts } from "@/lib/services/alert-feed";
import { requireUser } from "@/lib/auth/session";
import { getLookups } from "@/lib/services/lookups";
import { connectDB } from "@/lib/db/connect";
import { User, oid } from "@/lib/db/models";
import { logoutAction } from "@/app/actions/auth";

/**
 * App chrome is static and prerendered; the parts that need the session (quick add with
 * the user's categories, the user menu) stream in behind their own Suspense boundaries.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r bg-sidebar p-3 lg:flex">
        <div className="pt-2">
          <Brand showEmail />
        </div>
        <div className="flex-1 overflow-y-auto">
          <Suspense fallback={<NavList active={null} />}>
            <ActiveNav />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-1.5 border-b bg-background/90 px-3 pt-[env(safe-area-inset-top)] sm:gap-2 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-6">
          <MobileNav />
          {/* min-w-0 lets the name truncate on very narrow phones instead of pushing buttons off-screen. */}
          <div className="min-w-0 flex-1 lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <Suspense
              fallback={
                <Button variant="ghost" size="icon" disabled aria-label="Notifications">
                  <Bell />
                </Button>
              }
            >
              <AlertBellLoader />
            </Suspense>
            <InstallAppButton />
            <Suspense
              fallback={
                <Button size="lg" disabled>
                  <Plus /> <span className="min-[400px]:hidden">Add</span>
                  <span className="hidden min-[400px]:inline">Quick Add</span>
                </Button>
              }
            >
              <QuickAddLoader />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6">{children}</main>
      </div>
    </div>
  );
}

async function QuickAddLoader() {
  const user = await requireUser();
  await connectDB();
  const [lookups, doc] = await Promise.all([getLookups(user.id), User.findById(oid(user.id), { prefs: 1 }).lean()]);
  return (
    <QuickAdd
      categories={lookups.categories}
      persons={lookups.persons.filter((p) => !p.archived)}
      lastCategoryId={doc?.prefs?.lastCategoryId?.toString() ?? null}
      lastPaymentMethod={doc?.prefs?.lastPaymentMethod ?? "cash"}
    />
  );
}

async function AlertBellLoader() {
  const user = await requireUser();
  return <AlertBell alerts={await getActiveAlerts(user.id)} />;
}

async function UserMenu() {
  const user = await requireUser();
  return (
    <div className="flex items-center justify-between gap-2 border-t px-2.5 pt-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}
