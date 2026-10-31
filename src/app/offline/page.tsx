import type { Metadata } from "next";
import { OfflineApp } from "@/components/offline/offline-app";

export const metadata: Metadata = { title: "Offline" };

/**
 * The offline app shell. The service worker caches this page and its assets, and serves it
 * for any page that can't load without a connection. It needs no server data: everything
 * comes from this device's IndexedDB copy.
 */
export default function OfflinePage() {
  return <OfflineApp />;
}
