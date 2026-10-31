import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/**
 * Static fallback shown by the service worker when a page can't load offline.
 * Uses only inline styles and a plain link so it renders without any other cached files.
 */
export default function OfflinePage() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ maxWidth: 360 }}>
        <svg width="56" height="56" style={{ margin: "0 auto" }} viewBox="0 0 24 24" fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20h.01" />
          <path d="M8.5 16.43a5 5 0 0 1 7 0" />
          <path d="M5 12.86a10 10 0 0 1 5.17-2.69" />
          <path d="M19 12.86a10 10 0 0 0-2-1.49" />
          <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
          <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
          <path d="m2 2 20 20" />
        </svg>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "16px 0 8px" }}>You&apos;re offline</h1>
        <p style={{ fontSize: 14, opacity: 0.7, lineHeight: 1.5, margin: 0 }}>
          PocketLedger needs a connection to show your latest balances and save entries. Your data is safe — reconnect and try again.
        </p>
        {/* A full page load (not <Link>) so the service worker re-tries the network. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          style={{ display: "inline-block", marginTop: 20, padding: "10px 18px", borderRadius: 10, background: "#2a78d6", color: "#fff", fontSize: 14, fontWeight: 500, textDecoration: "none" }}
        >
          Try again
        </a>
      </div>
    </main>
  );
}
