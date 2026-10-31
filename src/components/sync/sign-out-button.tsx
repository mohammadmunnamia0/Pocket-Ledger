"use client";

import { useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { getSyncState, syncNow, wipeDevice } from "@/lib/offline/engine";

/**
 * Sign out and remove this device's offline copy. Warns first if changes made on this
 * device have not reached the server yet (they would be lost).
 */
export function SignOutButton({ children, variant = "outline", size = "default", label }: {
  children: ReactNode;
  variant?: "outline" | "ghost";
  size?: "default" | "icon-sm";
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (navigator.onLine) await syncNow().catch(() => undefined);
          const unsynced = getSyncState().pending;
          if (
            unsynced > 0 &&
            !window.confirm(
              `${unsynced} change${unsynced > 1 ? "s" : ""} made on this device ${unsynced > 1 ? "have" : "has"} not synced yet and will be lost if you sign out. Sign out anyway?`,
            )
          ) {
            return;
          }
          await wipeDevice();
          await logoutAction();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : children}
    </Button>
  );
}
