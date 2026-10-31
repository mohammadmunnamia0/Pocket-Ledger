import type { MetadataRoute } from "next";

/** Web app manifest — makes PocketLedger installable on the home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PocketLedger — Salary & Expense Tracker",
    short_name: "PocketLedger",
    description: "Track your salary, daily expenses, bills, family allocations and savings in Taka.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f9f9f7",
    theme_color: "#f9f9f7",
    lang: "en-BD",
    dir: "ltr",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Add expense",
        short_name: "Add expense",
        url: "/expenses/new",
        icons: [{ src: "/icons/shortcut-expense.png", sizes: "96x96", type: "image/png" }],
      },
      { name: "Transactions", url: "/transactions", icons: [{ src: "/icons/shortcut-expense.png", sizes: "96x96", type: "image/png" }] },
      { name: "Add salary", url: "/income", icons: [{ src: "/icons/shortcut-expense.png", sizes: "96x96", type: "image/png" }] },
    ],
  };
}
