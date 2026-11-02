import { Suspense } from "react";
import Link from "next/link";
import { Briefcase, ChevronRight, Code2, Shirt, Sparkles, Wallet } from "lucide-react";
import { CardsSkeleton, PageHeader } from "@/components/common";
import { Money } from "@/components/money";
import { requireUser } from "@/lib/auth/session";
import { getBalanceSummary } from "@/lib/services/finance";
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

/** The three businesses. Their accounting is added in the next phase. */
const BUSINESSES = [
  { name: "Alwin BD", type: "Online Clothing Brand", icon: Shirt },
  { name: "ReturnHex", type: "IT Firm", icon: Code2 },
  { name: "Naire", type: "Women's Lifestyle Brand", icon: Sparkles },
] as const;

async function AccountCards() {
  const user = await requireUser();
  const { spendable } = await getBalanceSummary(user.id, todayISO());
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
          <span className="mt-3 flex items-center gap-1 text-sm font-medium text-primary">
            Open dashboard <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
      </li>
      {BUSINESSES.map((b) => (
        <li key={b.name}>
          {/* Not a link yet: business accounting arrives in the next phase. */}
          <div className="flex h-full flex-col rounded-xl border border-dashed bg-card p-5" aria-label={`${b.name} — not set up yet`}>
            <AccountHead icon={b.icon} name={b.name} type={b.type} muted />
            <span className="mt-4 text-xs font-medium text-muted-foreground">Business account</span>
            <span className="text-sm text-muted-foreground">Not set up yet — business accounting is added in the next update.</span>
          </div>
        </li>
      ))}
    </ul>
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
