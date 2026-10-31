"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertList } from "@/components/alert-list";
import { HelpButton } from "@/components/help";
import { useAction } from "@/components/use-action";
import { markAllAlertsReadAction } from "@/app/actions/ledger";
import type { ShownAlert } from "@/lib/services/alerts";

/** Notification bell in the top bar: smart alerts with an unread badge. */
export function AlertBell({ alerts }: { alerts: ShownAlert[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const unread = alerts.filter((a) => !a.read).length;
  const urgent = alerts.some((a) => !a.read && a.priority === "high");
  const label = unread ? `Notifications — ${unread} unread` : "Notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={label} title={label} />}>
        <Bell />
        {unread > 0 && (
          <span
            aria-hidden
            className={`absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-white ${urgent ? "bg-critical-mark" : "bg-primary"}`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-1rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <div className="flex items-center gap-1">
            <p className="text-sm font-semibold">Notifications</p>
            <HelpButton topic="smartAlerts" className="size-5" />
          </div>
          {unread > 0 && (
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => markAllAlertsReadAction(), { success: false })}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain p-2">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              <BellOff className="size-5" aria-hidden />
              You&apos;re all caught up — no alerts right now.
            </div>
          ) : (
            <AlertList alerts={alerts} compact onNavigate={() => setOpen(false)} />
          )}
        </div>
        <div className="border-t px-3 py-2 text-right">
          <Link href="/alerts" onClick={() => setOpen(false)} className="text-xs font-medium text-primary hover:underline">
            Alert history &amp; settings →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
