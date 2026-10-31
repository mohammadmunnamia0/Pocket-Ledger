"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onServerChanged, startSync } from "@/lib/offline/engine";

/**
 * Keeps this device's offline copy in step with the server while the online app is open,
 * and refreshes the page when changes made offline have reached the server.
 */
export function SyncProvider({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    void startSync(userId);
    // After queued changes reach the server, re-render server data so they appear.
    return onServerChanged(() => router.refresh());
  }, [userId, router]);
  return null;
}
