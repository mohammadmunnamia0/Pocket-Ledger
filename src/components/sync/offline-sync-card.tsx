"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncNow } from "@/lib/offline/engine";
import { useSyncState } from "@/lib/offline/hooks";
import { cn } from "@/lib/utils";

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "not yet";

/** Settings summary of the device copy and the sync queue. */
export function OfflineSyncCard() {
  const s = useSyncState();
  return (
    <div className="grid gap-3 text-sm">
      <dl className="grid gap-1.5 sm:grid-cols-[auto_1fr] sm:gap-x-6">
        <dt className="text-muted-foreground">Connection</dt>
        <dd>{s.online ? (s.unreachable ? "Online, server unreachable" : "Online") : "Offline"}</dd>
        <dt className="text-muted-foreground">Copy on this device</dt>
        <dd>{s.hasSnapshot ? "Saved — available without internet" : "Not saved yet"}</dd>
        <dt className="text-muted-foreground">Last successful sync</dt>
        <dd>{fmt(s.lastSyncAt)}</dd>
        <dt className="text-muted-foreground">Changes waiting</dt>
        <dd className={cn(s.attention > 0 && "text-critical")}>
          {s.pending}
          {s.attention > 0 && ` (${s.attention} need${s.attention > 1 ? "" : "s"} your attention — open the cloud icon in the header)`}
        </dd>
      </dl>
      <div>
        <Button variant="outline" size="sm" disabled={!s.online || s.syncing} onClick={() => syncNow()}>
          <RefreshCw className={cn(s.syncing && "animate-spin")} /> {s.syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Signing out removes the copy stored on this device.</p>
    </div>
  );
}
