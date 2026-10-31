"use client";

import { useSyncExternalStore } from "react";
import { AlertTriangle, CloudCheck, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { discardEntry, keepMine, retryEntry, syncNow } from "@/lib/offline/engine";
import { useLocalData, useSyncState } from "@/lib/offline/hooks";
import { formatTaka } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

// A browser-only clock (the indicator is part of the prerendered page shell).
let clockNow = 0;
function subscribeClock(cb: () => void) {
  clockNow = Date.now();
  const t = setInterval(() => {
    clockNow = Date.now();
    cb();
  }, 30_000);
  return () => clearInterval(t);
}

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  if (!now) return "recently";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Online/offline status, queued changes, sync progress, last sync, and problem resolution. */
export function SyncIndicator() {
  const s = useSyncState();
  const { outbox } = useLocalData();
  const now = useSyncExternalStore(subscribeClock, () => clockNow, () => 0);
  const entries = s.userId ? outbox.filter((e) => e.userId === s.userId) : outbox;
  const otherAccount = outbox.length - entries.length;

  const offline = !s.online;
  const status = offline
    ? { icon: CloudOff, text: "Offline", tone: "text-muted-foreground" }
    : s.syncing
      ? { icon: Loader2, text: "Syncing…", tone: "text-primary", spin: true }
      : s.attention > 0
        ? { icon: AlertTriangle, text: "Needs your attention", tone: "text-critical" }
        : s.unreachable || s.signedOut
          ? { icon: CloudOff, text: s.signedOut ? "Sign in to sync" : "Can't reach server", tone: "text-warning" }
          : s.pending > 0
            ? { icon: RefreshCw, text: "Changes waiting", tone: "text-warning" }
            : { icon: CloudCheck, text: "All changes synced", tone: "text-good" };
  const Icon = status.icon;
  const label = `${status.text}${s.pending ? ` — ${s.pending} change${s.pending > 1 ? "s" : ""} waiting` : ""}`;

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={label} title={label} />}>
        <Icon className={cn(status.tone, status.spin && "animate-spin")} />
        {s.pending > 0 && (
          <span
            aria-hidden
            className={cn(
              "absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-white",
              s.attention ? "bg-critical-mark" : "bg-warning-mark text-black",
            )}
          >
            {s.pending > 9 ? "9+" : s.pending}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] gap-0 p-0">
        <div className="border-b px-3 py-2.5">
          <p className={cn("flex items-center gap-2 text-sm font-semibold", status.tone)}>
            <Icon className={cn("size-4", status.spin && "animate-spin")} aria-hidden /> {status.text}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {offline ? "You can keep working — changes are saved on this device." : `Last synced ${ago(s.lastSyncAt, now)}.`}
            {s.lastError && !offline && <span className="block text-warning">{s.lastError}</span>}
          </p>
        </div>

        <div className="max-h-[min(60dvh,26rem)] overflow-y-auto p-2">
          {entries.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">No changes waiting. Everything on this device matches the server.</p>
          ) : (
            <ul className="grid gap-2">
              {entries.map((e) => (
                <li key={e.opId} className={cn("rounded-lg border p-2.5 text-sm", e.status !== "pending" && "border-critical/40 bg-critical/5")}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium break-words">{e.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {e.status === "pending" ? "Waiting" : e.status === "conflict" ? "Conflict" : "Refused"}
                    </span>
                  </div>
                  {e.error && <p className="mt-1 text-xs text-critical">{e.error}</p>}
                  {e.status === "conflict" && e.server && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Server version: {e.server.title} · {formatTaka(e.server.amount)} · {formatDate(e.server.date)}
                    </p>
                  )}
                  {e.status === "conflict" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {e.op.kind !== "create" && e.server && (
                        <Button size="xs" onClick={() => keepMine(e.opId)}>
                          Keep mine
                        </Button>
                      )}
                      <Button size="xs" variant="outline" onClick={() => discardEntry(e.opId)}>
                        Keep the server&apos;s
                      </Button>
                    </div>
                  )}
                  {e.status === "failed" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="xs" onClick={() => retryEntry(e.opId)}>
                        Retry
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => discardEntry(e.opId)}>
                        Discard change
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {otherAccount > 0 && (
            <p className="mt-2 px-2 text-xs text-warning">
              {otherAccount} change{otherAccount > 1 ? "s" : ""} from another account are kept on this device and will sync when that account signs in.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">Saved on this device until the server confirms.</span>
          <Button size="xs" variant="outline" disabled={offline || s.syncing} onClick={() => syncNow()}>
            <RefreshCw className={cn(s.syncing && "animate-spin")} /> Sync now
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
