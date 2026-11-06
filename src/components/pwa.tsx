"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Download, Share, SquarePlus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* ------------------------------------------------------------------ Install state store */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** "installed" = running as an app · "prompt" = browser can install · "ios" = manual steps · "none" */
type InstallState = "installed" | "prompt" | "ios" | "none";

let deferredPrompt: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// The browser fires this once, early — capture it at module load so no component misses it.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    justInstalled = true;
    emit();
  });
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function getInstallState(): InstallState {
  if (justInstalled || isStandalone()) return "installed";
  if (deferredPrompt) return "prompt";
  if (isIOS()) return "ios";
  return "none";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getInstallState, () => "none");
}

async function promptInstall() {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; // a prompt can only be used once
  emit();
}

/* ------------------------------------------------------------------ Components */

/** Registers the service worker (production only; development stays cache-free). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((err) => {
      console.warn("Service worker registration failed", err);
    });
    // Keep the cached offline app in step with the deployed version (at most every 10 min).
    if (navigator.onLine && !location.pathname.startsWith("/offline")) {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem("pl-shell-cached") ?? 0);
      } catch {}
      if (Date.now() - last > 10 * 60_000) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.active?.postMessage({ type: "CACHE_SHELL" });
          try {
            sessionStorage.setItem("pl-shell-cached", String(Date.now()));
          } catch {}
        });
      }
    }
  }, []);
  return null;
}

/** A slim banner while the device is offline. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 bg-foreground px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-xs text-background">
      <WifiOff className="size-3.5" aria-hidden /> You&apos;re offline — changes are saved on this device and sync when you reconnect.
    </div>
  );
}

function IOSInstructions({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Install on iPhone or iPad</DialogTitle>
          <DialogDescription>Add PocketLedger to your Home Screen to open it like an app.</DialogDescription>
        </DialogHeader>
        <ol className="grid gap-3 text-sm">
          <li className="flex items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">1</span>
            <span>
              Tap the <Share className="inline size-4 align-text-bottom text-primary" aria-label="Share" /> Share button in the browser toolbar.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">2</span>
            <span>
              Choose <strong>Add to Home Screen</strong> <SquarePlus className="inline size-4 align-text-bottom" aria-hidden />.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">3</span>
            <span>
              Tap <strong>Add</strong>. Open PocketLedger from your Home Screen.
            </span>
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/** Compact header button — only rendered when the app can actually be installed. */
export function InstallAppButton() {
  const state = useInstallState();
  const [iosOpen, setIosOpen] = useState(false);
  if (state !== "prompt" && state !== "ios") return null;
  return (
    <>
      {/* Hidden on narrow phones so the app name fits; Settings → Install app is always there. */}
      <Button variant="outline" size="lg" className="max-[399px]:hidden" onClick={() => (state === "prompt" ? promptInstall() : setIosOpen(true))}>
        <Download /> <span className="hidden sm:inline">Install app</span>
        <span className="sr-only sm:hidden">Install app</span>
      </Button>
      <IOSInstructions open={iosOpen} onOpenChange={setIosOpen} />
    </>
  );
}

/** Settings section content explaining install for every platform. */
export function InstallAppCard() {
  const state = useInstallState();
  const [iosOpen, setIosOpen] = useState(false);
  if (state === "installed") {
    return (
      <p className="flex items-center gap-2 text-sm text-good">
        <CheckCircle2 className="size-4" aria-hidden /> PocketLedger is installed and running as an app on this device.
      </p>
    );
  }
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-muted-foreground">
        Install PocketLedger on your home screen to open it full-screen like a native app, with shortcuts to add an expense or salary.
      </p>
      {state === "prompt" && (
        <div>
          <Button onClick={promptInstall}>
            <Download /> Install app
          </Button>
        </div>
      )}
      {state === "ios" && (
        <div>
          <Button onClick={() => setIosOpen(true)}>
            <Download /> How to install on iPhone
          </Button>
          <IOSInstructions open={iosOpen} onOpenChange={setIosOpen} />
        </div>
      )}
      {state === "none" && (
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong className="text-foreground">Android (Chrome):</strong> open the ⋮ menu → <em>Install app</em> / <em>Add to Home screen</em>.
          </li>
          <li>
            <strong className="text-foreground">iPhone / iPad (Safari):</strong> tap Share → <em>Add to Home Screen</em>.
          </li>
          <li>
            <strong className="text-foreground">Desktop (Chrome / Edge):</strong> click the install icon in the address bar.
          </li>
        </ul>
      )}
    </div>
  );
}
