"use client";

/**
 * The offline app. Served by the service worker for any page when there is no connection,
 * and runs entirely from this device's IndexedDB copy. Every figure comes from the shared
 * model (lib/ledger/model.ts), and every change goes into the sync queue.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, HandCoins, Pencil, Search, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Meter, Section, StatusBadge } from "@/components/common";
import { Money } from "@/components/money";
import { NativeSelect } from "@/components/form-controls";
import { ConfirmButton } from "@/components/confirm-button";
import { TransactionForm } from "@/components/transaction-form";
import { SyncIndicator } from "@/components/sync/sync-indicator";
import { useAction } from "@/components/use-action";
import { reportUnreachable, startSync } from "@/lib/offline/engine";
import { offlineCreate, offlineDelete, offlineUpdate, useLocalData, useSyncState } from "@/lib/offline/hooks";
import { buildLocalTxns, localFigures, toInput, type LocalTxn } from "@/lib/offline/view";
import { expenseLines, groupByCategory, runningBalances, sortLedger, spendableDelta, summarizePeriod } from "@/lib/ledger/model";
import { addMonths, formatDate, formatMonthLong, monthEnd, monthOf, monthStart, todayISO } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, TXN_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { IN_TYPES, LINKED_TYPES, OUT_TYPES } from "@/lib/constants";
import type { Snapshot } from "@/lib/sync/types";

/* ------------------------------------------------------------------ routing inside the offline app */

const TABS = [
  { path: "/", label: "Accounts" },
  { path: "/personal", label: "Home" },
  { path: "/transactions", label: "Transactions" },
  { path: "/expenses/new", label: "Add" },
  { path: "/income/history", label: "Salary history" },
  { path: "/reports", label: "Report" },
  { path: "/people", label: "Borrowed" },
  { path: "/savings", label: "Savings" },
] as const;

function initialPath() {
  const from = new URLSearchParams(window.location.search).get("from");
  return from && from.startsWith("/") && !from.startsWith("/offline") ? from.split("?")[0] : "/";
}

// The page is prerendered, so the URL and today's date are read only in the browser.
const routeListeners = new Set<() => void>();
function subscribeRoute(fn: () => void) {
  routeListeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    routeListeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
}
const noSubscribe = () => () => {};

function useShellRoute() {
  const path = useSyncExternalStore(subscribeRoute, initialPath, () => null);
  const go = (to: string) => {
    window.history.pushState(null, "", `/offline?from=${encodeURIComponent(to)}`);
    routeListeners.forEach((l) => l());
    window.scrollTo({ top: 0 });
  };
  return { path, go };
}

/* ------------------------------------------------------------------ app */

export function OfflineApp() {
  const sync = useSyncState();
  const { snapshot, outbox } = useLocalData();
  const { path, go } = useShellRoute();
  const today = useSyncExternalStore(noSubscribe, todayISO, () => null);

  useEffect(() => {
    // This app only opens when the server didn't answer — even if the device says it's online.
    // The first successful sync clears this.
    if (navigator.onLine) reportUnreachable();
    void startSync();
  }, []);

  const txns = useMemo(() => (snapshot ? buildLocalTxns(snapshot, outbox) : []), [snapshot, outbox]);

  if (!sync.ready || !path || !today) {
    return (
      <Frame>
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </Frame>
    );
  }

  if (!snapshot) {
    return (
      <Frame>
        <EmptyState
          title="No saved copy on this device yet"
          description="Open PocketLedger once while you're online and signed in. After that your records are available here even without internet."
          action={
            // A full reload (not client navigation) so the browser re-checks the connection.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <Button nativeButton={false} render={<a href="/" />}>
              Try again
            </Button>
          }
        />
      </Frame>
    );
  }

  const ctx: ViewCtx = { snapshot, txns, today, go };
  const [, a, b] = path.split("/");
  let view: ReactNode;
  if (path === "/" || path === "") view = <AccountsView {...ctx} />;
  else if (a === "personal") view = <HomeView {...ctx} />;
  else if (a === "transactions" && b && path.endsWith("/edit")) view = <EditView {...ctx} id={decodeURIComponent(b)} />;
  else if (a === "transactions" && b) view = <DetailView {...ctx} id={decodeURIComponent(b)} />;
  else if (a === "transactions") view = <TransactionsView {...ctx} />;
  else if ((a === "expenses" && b === "new") || (a === "income" && !b)) view = <AddView {...ctx} initialMode={a === "income" ? "income" : "expense"} />;
  else if (a === "income" && b === "history") view = <HistoryView {...ctx} />;
  else if (a === "reports") view = <ReportView {...ctx} />;
  else if (a === "people") view = <BorrowedView {...ctx} />;
  else if (a === "savings") view = <SavingsView {...ctx} />;
  else
    view = (
      <>
        <p className="mb-4 rounded-lg border border-warning-mark/40 bg-warning-mark/10 px-3 py-2 text-sm">
          That page needs an internet connection. Here is your offline overview instead.
        </p>
        <HomeView {...ctx} />
      </>
    );

  return (
    <Frame path={path} go={go} snapshot={snapshot}>
      {view}
    </Frame>
  );
}

interface ViewCtx {
  snapshot: Snapshot;
  txns: LocalTxn[];
  today: string;
  go: (to: string) => void;
}

/* ------------------------------------------------------------------ frame */

function Frame({ children, path, go, snapshot }: { children: ReactNode; path?: string; go?: (to: string) => void; snapshot?: Snapshot }) {
  const sync = useSyncState();
  const back = sync.online && !sync.unreachable;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:px-6">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <HandCoins className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 truncate font-semibold">PocketLedger</span>
          <span
            className={cn(
              "ml-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              back ? "bg-good-mark/15 text-good" : "bg-muted text-muted-foreground",
            )}
          >
            {back ? <Wifi className="size-3" aria-hidden /> : <CloudOff className="size-3" aria-hidden />}
            {back ? "Online" : "Offline mode"}
          </span>
          <div className="ml-auto">
            <SyncIndicator />
          </div>
        </div>
        {go && (
          <nav aria-label="Offline sections" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2 sm:px-6">
            {TABS.map((t) => {
              const on = t.path === "/" ? path === "/" : path?.startsWith(t.path);
              return (
                <button
                  key={t.path}
                  type="button"
                  onClick={() => go(t.path)}
                  aria-current={on ? "page" : undefined}
                  className={cn("shrink-0 rounded-full px-3 py-1.5 text-sm", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-3 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6">
        {back && path && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-good-mark/40 bg-good-mark/10 px-3 py-2 text-sm">
            <span>You&apos;re back online{sync.pending ? " — syncing your changes" : ""}.</span>
            <Button size="sm" nativeButton={false} render={<a href={path} />}>
              Open the full app
            </Button>
          </div>
        )}
        {snapshot && (
          <p className="mb-3 text-xs text-muted-foreground">
            Showing the copy saved on this device (last updated {formatDateTime(snapshot.serverTime)}){sync.pending ? ` plus ${sync.pending} change${sync.pending > 1 ? "s" : ""} not synced yet` : ""}.
          </p>
        )}
        {children}
      </main>
    </div>
  );
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function SyncBadge({ t }: { t: LocalTxn }) {
  if (!t.syncState) return null;
  const problem = t.syncStatus && t.syncStatus !== "pending";
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", problem ? "bg-critical/10 text-critical" : "bg-warning-mark/15 text-warning")}>
      {problem ? "Needs attention" : t.syncState === "new" ? "Not synced yet" : "Edited offline"}
    </span>
  );
}

const sign = (t: LocalTxn) => (IN_TYPES.includes(t.type) ? 1 : OUT_TYPES.includes(t.type) ? -1 : 0);

function TxnRow({ t, go, balance }: { t: LocalTxn; go: (to: string) => void; balance?: number }) {
  const s = sign(t);
  return (
    <li>
      <button type="button" onClick={() => go(`/transactions/${encodeURIComponent(t.id)}`)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{t.incomeLabel || t.title}</span> <SyncBadge t={t} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatDate(t.date)} · {t.categoryLabel ?? TXN_TYPE_LABELS[t.type]}
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Money value={s === 0 ? t.amount : s * t.amount} signed={s > 0} tone={s > 0 ? "income" : t.status === "pending" ? "muted" : "default"} className="text-sm font-medium" />
          {t.status === "pending" ? (
            <StatusBadge status="pending" />
          ) : balance !== undefined ? (
            <span className="text-[11px] text-muted-foreground tabular">Bal {formatTaka(balance)}</span>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function Card({ label, value, hint, highlight, onClick }: { label: string; value: number; hint?: string; highlight?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex flex-col rounded-xl border bg-card p-4 text-left", highlight && "border-primary/40 bg-primary/5", onClick && "hover:border-foreground/20")}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("mt-1 font-semibold tracking-tight", highlight ? "text-3xl" : "text-xl")}>
        <Money value={value} tone="auto" />
      </span>
      {hint && <span className="mt-1 text-xs text-muted-foreground">{hint}</span>}
    </button>
  );
}

/** A private amount ("+ Latest salary", Savings, Investment), blurred until the first tap (as online); the next tap opens it. */
function RevealCard({ label, value, hint, onOpen }: { label: string; value: number; hint: string; onOpen: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (shown ? onOpen() : setShown(true))}
      aria-label={shown ? undefined : `${label}: hidden. Tap to show the amount.`}
      className="flex min-w-0 flex-col rounded-xl border bg-card p-4 text-left hover:border-foreground/20"
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="mt-1 text-xl font-semibold tracking-tight tabular">
        {shown ? <span className="text-primary">{formatTaka(value)}</span> : <span className="pointer-events-none select-none blur-[6px]" aria-hidden>{formatTaka(value)}</span>}
      </span>
      <span className="mt-1 text-xs text-muted-foreground">{shown ? hint : "Hidden — tap to show"}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ views */

/** The four account cards (as online). Business accounting isn't available yet. */
function AccountsView({ snapshot, txns, today, go }: ViewCtx) {
  const f = localFigures(snapshot, txns, today);
  return (
    <div className="space-y-3">
      <h1 className="text-sm font-semibold">Your accounts</h1>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <li>
          <button type="button" onClick={() => go("/personal")} className="flex w-full flex-col rounded-xl border border-primary/40 bg-primary/5 p-5 text-left">
            <span className="font-semibold">Personal Finance</span>
            <span className="text-xs text-muted-foreground">Salary, expenses, savings, loans &amp; investments</span>
            <span className="mt-3 text-xs font-medium text-muted-foreground">Remaining balance</span>
            <span className="text-3xl font-semibold tracking-tight">
              <Money value={f.metrics.availableNow} tone="auto" />
            </span>
          </button>
        </li>
        {(["Alwin BD", "ReturnHex", "Naire"] as const).map((name) => (
          <li key={name} className="rounded-xl border border-dashed bg-card p-5">
            <span className="font-semibold">{name}</span>
            <span className="mt-2 block text-sm text-muted-foreground">Business accounts need an internet connection — open them when you are back online.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HomeView({ snapshot, txns, today, go }: ViewCtx) {
  const f = localFigures(snapshot, txns, today);
  const p = f.period;
  const recent = sortLedger(txns).reverse().slice(0, 8);
  return (
    <div className="space-y-5">
      <section>
        <h1 className="mb-3 text-sm font-semibold">{p ? `This salary period · since ${formatDate(p.receivedOn)}` : "This salary period"}</h1>
        {!p ? (
          <EmptyState title="No salary recorded yet" description="Add your salary under Add → Income." />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card highlight label="= Remaining balance" value={p.remaining} hint={`${formatTaka(p.totalAvailable)} available − ${formatTaka(p.spends)} spent`} onClick={() => go("/transactions")} />
            <Card label="Previous salary carryforward" value={p.carriedIn} hint={p.carriedFrom.length ? `Left from ${p.carriedFrom.map((c) => c.label).join(" + ")}` : "Nothing left from earlier salaries"} onClick={() => go("/income/history")} />
            <RevealCard label="+ Latest salary" value={p.salary} hint={`${p.label}, received ${formatDate(p.receivedOn)}`} onOpen={() => go("/income/history")} />
            <Card label="= Total available" value={p.totalAvailable} />
            <Card label="− Spends this period" value={p.spends} hint={`${p.paymentCount} payments since ${formatDate(p.receivedOn)}`} />
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Savings &amp; commitments</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <RevealCard label="Savings" value={f.metrics.savingsGoals} hint="In savings goals — not in Remaining balance" onOpen={() => go("/savings")} />
          <RevealCard label="Investment" value={f.metrics.invested} hint="Invested and not yet returned — not in Remaining balance" onOpen={() => go("/savings")} />
          <Card label="Pending payments" value={f.metrics.pendingTotal} hint={f.metrics.pendingCount ? `${f.metrics.pendingCount} not paid yet` : "Nothing waiting"} onClick={() => go("/transactions")} />
          <Card label="Borrowed money left" value={f.borrowed.remaining} hint={`Borrowed ${formatTaka(f.borrowed.total)} · Repaid ${formatTaka(f.borrowed.repaid)}`} onClick={() => go("/people")} />
        </div>
      </section>
      <Section title="Recent transactions">
        {recent.length ? (
          <ul className="-mx-3 divide-y">
            {recent.map((t) => (
              <TxnRow key={t.id} t={t} go={go} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No transactions yet" />
        )}
      </Section>
    </div>
  );
}

function TransactionsView({ txns, go }: ViewCtx) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const balances = useMemo(() => runningBalances(txns), [txns]);
  const filtered = sortLedger(txns)
    .reverse()
    .filter((t) => {
      if (kind === "out" && !OUT_TYPES.includes(t.type)) return false;
      if (kind === "in" && !IN_TYPES.includes(t.type)) return false;
      if (kind === "pending" && t.status !== "pending") return false;
      if (kind === "unsynced" && !t.syncState) return false;
      if (!q.trim()) return true;
      const needle = q.trim().toLowerCase();
      return [t.title, t.incomeLabel, t.notes, t.categoryLabel, ...t.items.map((i) => i.name)].some((v) => v?.toLowerCase().includes(needle));
    });
  const showBalance = !q.trim() && !kind;
  const out = filtered.filter((t) => t.status === "paid" && (t.type === "expense" || t.type === "savings_deposit")).reduce((s, t) => s + t.amount, 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, notes, items…" className="h-9 pl-8" aria-label="Search transactions" />
        </div>
        <NativeSelect aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All transactions</option>
          <option value="out">Money out (spends &amp; savings)</option>
          <option value="in">Money in (income)</option>
          <option value="pending">Pending payments</option>
          <option value="unsynced">Not synced yet</option>
        </NativeSelect>
      </div>
      {!showBalance && (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm">
          {filtered.length} transactions{out ? ` · Money out ${formatTaka(out)}` : ""}
          <span className="block text-xs text-muted-foreground">Running balance is hidden while filtering.</span>
        </p>
      )}
      {filtered.length === 0 ? (
        <EmptyState title="No transactions found" />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {filtered.map((t) => (
            <TxnRow key={t.id} t={t} go={go} balance={showBalance ? balances.get(t.id) : undefined} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BackLink({ go, to, label }: { go: (to: string) => void; to: string; label: string }) {
  return (
    <button type="button" onClick={() => go(to)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> {label}
    </button>
  );
}

function DetailView({ txns, go, id, today }: ViewCtx & { id: string }) {
  const t = txns.find((x) => x.id === id);
  const { pending, run } = useAction();
  const [paidOn, setPaidOn] = useState(today);
  if (!t) {
    return (
      <>
        <BackLink go={go} to="/transactions" label="Transactions" />
        <EmptyState title="This transaction isn't on this device" description="It may have been deleted, or it was added on another device after the last sync." />
      </>
    );
  }
  const title = t.incomeLabel || t.title;
  const linked = LINKED_TYPES.includes(t.type);
  const editable = !t.type.startsWith("savings") && !linked;
  const rows: [string, ReactNode][] = [
    ["Type", TXN_TYPE_LABELS[t.type]],
    [t.status === "pending" ? "Due date" : "Date", formatDate(t.date)],
    ["Belongs to month", formatMonthLong(t.attributionMonth)],
    ...(t.categoryLabel ? ([["Category", t.categoryLabel]] as [string, ReactNode][]) : []),
    ...(t.type !== "transfer"
      ? ([[IN_TYPES.includes(t.type) ? "Kept in" : "Paid from", t.accountName ?? PAYMENT_METHOD_LABELS[t.paymentMethod]]] as [string, ReactNode][])
      : []),
    ...(t.personName ? ([["Person", t.personName]] as [string, ReactNode][]) : []),
    ...(t.notes ? ([["Notes", <span key="n" className="whitespace-pre-wrap">{t.notes}</span>]] as [string, ReactNode][]) : []),
  ];
  return (
    <div className="space-y-4">
      <BackLink go={go} to="/transactions" label="Transactions" />
      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          {title} <SyncBadge t={t} />
        </h1>
        <p className="mt-1 flex items-center gap-3">
          <Money value={sign(t) === 0 ? t.amount : sign(t) * t.amount} signed={sign(t) > 0} tone={sign(t) > 0 ? "income" : "default"} className="text-2xl font-semibold" />
          <StatusBadge status={t.status} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button variant="outline" size="sm" onClick={() => go(`/transactions/${encodeURIComponent(t.id)}/edit`)}>
            <Pencil /> Edit
          </Button>
        )}
        {linked ? (
          <p className="text-xs text-muted-foreground">Part of a loan or investment — change it from Lending &amp; Borrowing or Investments when you&apos;re online.</p>
        ) : (
          <ConfirmButton
            title={`Delete “${title}”?`}
            description="Saved on this device now and removed from the server when you're back online. Balances recalculate right away."
            action={() => offlineDelete({ id: t.id, updatedAt: t.updatedAt, title })}
            onDone={() => go("/transactions")}
          >
            <Trash2 /> Delete
          </ConfirmButton>
        )}
      </div>
      {t.status === "pending" && editable && (
        <Section title="Mark as paid">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => offlineUpdate(t, toInput(t, { status: "paid", date: paidOn })), { success: "Marked paid on this device — will sync" });
            }}
          >
            <label className="grid gap-1 text-xs text-muted-foreground">
              Payment date
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              <CheckCircle2 /> Confirm payment
            </Button>
          </form>
        </Section>
      )}
      <Section title="Details">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {t.items.length > 0 && (
        <Section title="Breakdown">
          <ul className="divide-y text-sm">
            {t.items.map((i) => (
              <li key={i.id} className="flex justify-between py-2">
                <span>
                  {i.name}
                  {i.categoryLabel && <span className="block text-xs text-muted-foreground">{i.categoryLabel}</span>}
                </span>
                <Money value={i.amount} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function formLookups(snapshot: Snapshot, txns: LocalTxn[]) {
  return {
    categories: snapshot.lookups.categories,
    accounts: snapshot.lookups.accounts,
    persons: snapshot.lookups.persons,
    incomes: sortLedger(txns.filter((t) => t.type === "income" && !t.syncState))
      .reverse()
      .slice(0, 36)
      .map((t) => ({ id: t.id, label: t.incomeLabel || t.title, date: t.date, amount: t.amount })),
  };
}

function AddView({ snapshot, txns, today, go, initialMode }: ViewCtx & { initialMode: "expense" | "income" }) {
  const [mode, setMode] = useState<"expense" | "income" | "transfer">(initialMode);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Add</h1>
      <div className="inline-flex rounded-lg bg-muted p-1" role="tablist">
        {(["expense", "income", "transfer"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1.5 text-sm capitalize", mode === m && "bg-card font-medium shadow-sm")}>
            {m}
          </button>
        ))}
      </div>
      <Section>
        <TransactionForm
          key={mode}
          mode={mode}
          lookups={formLookups(snapshot, txns)}
          defaults={{ date: today, paymentMethod: "cash", accountId: snapshot.lookups.accounts.find((a) => a.isDefault)?.id ?? null, incomeKind: "salary" }}
          onSave={offlineCreate}
          onDone={() => go("/transactions")}
        />
      </Section>
    </div>
  );
}

function EditView({ snapshot, txns, today, go, id }: ViewCtx & { id: string }) {
  const t = txns.find((x) => x.id === id);
  if (!t || t.type.startsWith("savings")) return <DetailView snapshot={snapshot} txns={txns} today={today} go={go} id={id} />;
  return (
    <div className="space-y-4">
      <BackLink go={go} to={`/transactions/${encodeURIComponent(id)}`} label="Back" />
      <h1 className="text-xl font-semibold">Edit transaction</h1>
      <Section>
        <TransactionForm
          mode={t.type as "expense" | "income" | "transfer"}
          lookups={formLookups(snapshot, txns.filter((x) => x.id !== id))}
          defaults={{ date: today }}
          initial={t}
          onSave={(payload) => offlineUpdate(t, payload)}
          onDone={() => go(`/transactions/${encodeURIComponent(id)}`)}
        />
      </Section>
    </div>
  );
}

function HistoryView({ snapshot, txns, today }: ViewCtx) {
  const cycles = [...localFigures(snapshot, txns, today).cycles].reverse();
  if (cycles.length === 0) return <EmptyState title="No salary recorded yet" />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Salary history</h1>
      {cycles.map((c, i) => {
        const current = c.end === null;
        const payments = sortLedger(txns.filter((t) => t.status === "paid" && (t.type === "expense" || t.type === "savings_deposit") && t.date >= c.start && (current || t.date <= c.end!)));
        return (
          <Section
            key={c.salaryId}
            title={`${c.label}${current ? " · current" : ""}`}
            description={`Received ${formatDate(c.start)} · period ${formatDate(c.start)} – ${current ? "today" : formatDate(c.end)}`}
          >
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Fig label="Carried in" value={c.carriedIn} hint={c.carriedFrom.length ? `from ${c.carriedFrom.map((x) => x.label).join(", ")}` : "nothing from before"} />
              <Fig label="+ Salary received" value={c.startingAmount} />
              <Fig label="= Total available" value={c.totalAvailable} />
              <Fig label="− Spent in period" value={c.totalSpent} hint={`${c.expenseCount} payments`} />
              <Fig label={current ? "= Left now" : "= Carried to next salary"} value={c.remainingAtEnd} strong hint={!current && i > 0 ? `→ ${cycles[i - 1].label}` : undefined} />
            </dl>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">Show the {payments.length} payments</summary>
              <ul className="mt-2 divide-y">
                {payments.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="text-muted-foreground">{formatDate(t.date)}</span> · {t.title} <SyncBadge t={t} />
                    </span>
                    <span className="tabular">{formatTaka(t.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </Section>
        );
      })}
    </div>
  );
}

function Fig({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className={cn(strong && "col-span-2 sm:col-span-1")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5", strong ? "text-lg font-semibold" : "font-medium")}>
        <Money value={value} tone="auto" />
      </dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function ReportView({ snapshot, txns, today }: ViewCtx) {
  const [month, setMonth] = useState(monthOf(today));
  const from = monthStart(month);
  const to = monthEnd(month);
  const opening = txns.filter((t) => t.date < from).reduce((s, t) => s + spendableDelta(t), 0);
  const inMonth = sortLedger(txns.filter((t) => t.date >= from && t.date <= to));
  const r = summarizePeriod(opening, inMonth, snapshot.lookups);
  const cats = groupByCategory(inMonth.filter((t) => t.type === "expense" && t.status === "paid").flatMap((t) => expenseLines(t)), snapshot.lookups);
  const lines: [string, number, string?][] = [
    ["Opening balance (carried forward)", r.openingBalance],
    ["+ Salary", r.salary],
    ["+ Additional income", r.additionalIncome + r.broughtIn],
    ...(r.otherInflows ? ([["+ Investment capital back (not income)", r.otherInflows]] as [string, number][]) : []),
    ["= Total money this month (before spending)", r.totalAvailable, "font-medium border-t"],
    ["− Expenses", r.expenses],
    ["− Savings / investments (net)", r.savingsAndTransfers],
    ["= Closing balance (money left)", r.closingBalance, "font-semibold border-t"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </Button>
        <h1 className="text-xl font-semibold">{formatMonthLong(month)}</h1>
        <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <Section title="Balance summary">
        <table className="w-full text-sm">
          <tbody className="tabular">
            {lines.map(([label, value, cls]) => (
              <tr key={label} className={cn(cls)}>
                <td className="py-1.5 pr-3">{label}</td>
                <td className="py-1.5 text-right">
                  <Money value={value} tone="auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(r.loansIn > 0 || r.loansOut > 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Lending &amp; borrowing (not in the balance): {formatTaka(r.loansOut)} lent or repaid to lenders · {formatTaka(r.loansIn)} borrowed or repaid to you
          </p>
        )}
      </Section>
      <Section title="Category-wise spending">
        {cats.length === 0 ? (
          <EmptyState title="No spending this month" />
        ) : (
          <ul className="divide-y text-sm">
            {cats.map((c) => (
              <li key={c.id} className="flex justify-between py-2">
                <span>{c.name}</span>
                <span className="font-medium tabular">{formatTaka(c.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function BorrowedView({ snapshot, txns, today }: ViewCtx) {
  const b = localFigures(snapshot, txns, today).borrowed;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Borrowed money</h1>
      {b.byPerson.length === 0 ? (
        <EmptyState title="Nothing owed" />
      ) : (
        b.byPerson.map((p) => (
          <Section key={p.id} title={p.name}>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <Fig label="Borrowed" value={p.borrowed} />
              <Fig label="Repaid" value={p.repaid} />
              <Fig label="Remaining" value={p.remaining} strong />
            </dl>
            <Meter value={p.repaid} max={p.borrowed} className="mt-3 h-1.5" label="Repaid" />
            {p.open.length > 0 && (
              <ul className="mt-3 text-sm">
                {p.open.map((o) => (
                  <li key={o.month} className="flex justify-between py-1">
                    <span>
                      {formatMonthLong(o.month)}
                      {o.note && <span className="text-xs text-muted-foreground"> · {o.note}</span>}
                    </span>
                    <span className="tabular">{formatTaka(o.remaining)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">To record a repayment offline, add an expense and choose {p.name} as the related person.</p>
          </Section>
        ))
      )}
    </div>
  );
}

function SavingsView({ snapshot, txns, today }: ViewCtx) {
  const f = localFigures(snapshot, txns, today);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Savings</h1>
      <p className="text-sm text-muted-foreground">
        In savings: <Money value={f.metrics.inSavings} className="font-medium text-foreground" /> (goals {formatTaka(f.metrics.savingsGoals)} · invested {formatTaka(f.metrics.invested)})
      </p>
      {snapshot.lookups.goals.length === 0 ? (
        <EmptyState title="No savings goals yet" />
      ) : (
        snapshot.lookups.goals.map((g) => {
          const balance = txns
            .filter((t) => t.goalId === g.id && t.date <= today)
            .reduce((s, t) => s + (t.type === "savings_deposit" ? t.amount : t.type === "savings_withdrawal" ? -t.amount : 0), 0);
          const target = snapshot.goalTargets.find((x) => x.id === g.id)?.targetAmount ?? 0;
          return (
            <Section key={g.id} title={g.name} description={g.status}>
              <Meter value={balance} max={target} label={`${g.name} progress`} />
              <p className="mt-2 text-sm">
                <Money value={balance} className="font-medium" /> of {formatTaka(target)}
              </p>
            </Section>
          );
        })
      )}
      <p className="text-xs text-muted-foreground">Moving money into or out of savings goals needs a connection.</p>
    </div>
  );
}
