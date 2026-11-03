import { Suspense } from "react";
import Link from "next/link";
import { Briefcase, ChevronRight, Code2, Shirt, Sparkles, Wallet } from "lucide-react";
import { CardsSkeleton, PageHeader } from "@/components/common";
import { Money } from "@/components/money";
import { requireUser } from "@/lib/auth/session";
import { getBalanceSummary } from "@/lib/services/finance";
import { listBusinessCards } from "@/lib/services/business";
import { BUSINESSES } from "@/lib/business/registry";
import { todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** The first screen: one card per financial account. Nothing opens automatically. */
export default function AccountsHomePage() {
  return (
    <>
      <PageHeader title="Your accounts" help="home" description="Choose an account to open its dashboard. Each account keeps its own money and records." />
      <Suspense fallback={<CardsSkeleton count={4} />}>
        <AccountCards />
      </Suspense>
    </>
  );
}

const ICONS = { shirt: Shirt, code: Code2, sparkles: Sparkles } as const;

async function AccountCards() {
  const user = await requireUser();
  const [{ spendable }, businesses] = await Promise.all([getBalanceSummary(user.id, todayISO()), listBusinessCards(user.id)]);
  // Alwin BD + ReturnHex: one extra line on both cards (each keeps its own balance and records).
  const COMBINED = ["alwin-bd", "returnhex"];
  const pair = businesses.filter((b) => COMBINED.includes(b.key));
  const combined = pair.length === 2 && pair.every((b) => b.balance !== null) ? pair.reduce((s, b) => s + b.balance!, 0) : null;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <li>
        <Link
          href="/personal"
          className="group flex h-full flex-col rounded-xl border border-primary/40 bg-primary/5 p-5 transition-colors hover:border-primary/60"
        >
          <AccountHead icon={Wallet} name="Personal Finance" type="Salary, expenses, savings, loans & investments" />
          <span className="mt-4 text-xs font-medium text-muted-foreground">Remaining balance</span>
          <span className="text-3xl font-semibold tracking-tight">
            <Money value={spendable} tone="auto" />
          </span>
          <OpenLabel text="Open dashboard" />
        </Link>
      </li>
      {businesses.map((b) => {
        const icon = ICONS[BUSINESSES.find((x) => x.key === b.key)!.icon];
        if (!b.available) {
          return (
            <li key={b.key}>
              {/* Not a link yet: this business is added in a later phase. */}
              <div className="flex h-full flex-col rounded-xl border border-dashed bg-card p-5" aria-label={`${b.name} — not set up yet`}>
                <AccountHead icon={icon} name={b.name} type={b.type} muted />
                <span className="mt-4 text-xs font-medium text-muted-foreground">Business account</span>
                <span className="text-sm text-muted-foreground">Not set up yet — added in a later update.</span>
              </div>
            </li>
          );
        }
        return (
          <li key={b.key}>
            <Link href={`/business/${b.key}`} className="group flex h-full flex-col rounded-xl border bg-card p-5 transition-colors hover:border-foreground/20">
              <AccountHead icon={icon} name={b.name} type={b.type} />
              <span className="mt-4 text-xs font-medium text-muted-foreground">Available balance</span>
              {b.balance === null ? (
                <span className="text-sm text-muted-foreground">Not set up yet — enter its opening balance to start.</span>
              ) : (
                <span className="text-3xl font-semibold tracking-tight">
                  <Money value={b.balance} tone="auto" />
                </span>
              )}
              {combined !== null && COMBINED.includes(b.key) && (
                <span className="text-xs text-muted-foreground">
                  Combined Total Balance: <Money value={combined} tone="auto" className="font-medium text-foreground" />
                </span>
              )}
              <OpenLabel text={b.balance === null ? "Set up" : "Open dashboard"} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function OpenLabel({ text }: { text: string }) {
  return (
    <span className="mt-3 flex items-center gap-1 text-sm font-medium text-primary">
      {text} <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </span>
  );
}

function AccountHead({ icon: Icon, name, type, muted = false }: { icon: typeof Briefcase; name: string; type: string; muted?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", muted ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground")}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="grid min-w-0">
        <span className="truncate font-semibold">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{type}</span>
      </span>
    </span>
  );
}
