# Pocket-Ledger

A personal salary, expense and savings ledger in Bangladeshi Taka (৳). Each salary is tracked separately: expenses are funded from the oldest salary that still has money (FIFO), leftovers carry forward automatically, and every figure on screen is derived from transaction records in MongoDB.

**Stack:** Next.js 16 (App Router, Cache Components, Server Actions) · TypeScript · Tailwind CSS 4 · shadcn/ui (Base UI) · Recharts · MongoDB + Mongoose · Vitest

## Features

- **Dashboard** shows total available, salary, income, expenses, remaining balance, savings and pending payments. It also has a salary carry-forward widget, daily and category charts, income vs. expenses, recent transactions, upcoming bills and smart alerts.
- **Quick Add**: a five-field expense dialog available on every page. It remembers your last category and payment method.
- **Expenses** can be a simple expense or an itemized breakdown; the total is always computed from the items. Each expense can be paid or pending, linked to a person or a "belongs to" month, and given a manual funding-salary override.
- **Income & Salary**: one record per salary, showing used, remaining, carried forward, status (unused / partially used / exhausted) and the date it was exhausted. Each salary has a page listing every expense it funded.
- **Transactions**: search and filters, a running balance after every row, edit, delete with confirmation, and CSV export.
- **Categories**: a two-level tree. You can create, rename, move and delete categories; deleting one reassigns its transactions so nothing is orphaned.
- **Family & Allocations**: monthly allocations are commitments, not expenses. Paid and remaining amounts come from payment records.
- **Utility Bills**: billing month, payment date, recharge date and coverage period are stored separately. Recurring bills drive the upcoming and overdue reminders.
- **Savings Goals** (including a Medical Emergency Fund): deposits and withdrawals are confirmed in two steps, and a goal can be linked to a separate account.
- **Monthly Reports** come in two independent views. Calendar month shows opening → income → outflows → closing, with categories, filters and CSV export. Salary cycles run from one salary's received date to the next.
- **Smart Financial Alerts** are built from real figures, with priorities, read/dismiss, history and preferences.
- **Import**: CSV import of historical salaries, expenses, breakdowns, bills and allocations, with a validated preview and atomic commit.
- **Auth**: a single-user account with bcrypt password hashing and a signed HTTP-only session cookie. Every action and route re-verifies the session.

## Install as an app (PWA)

PocketLedger can be installed on your home screen and opens full-screen like a native app. It also has home-screen shortcuts for **Add expense**, **Transactions** and **Add salary**.

- **Android (Chrome):** tap **Install app** in the header, or use ⋮ → *Install app*.
- **iPhone / iPad (Safari):** tap **Install app** for step-by-step instructions (Share → *Add to Home Screen*).
- **Desktop (Chrome / Edge):** use the install icon in the address bar.

Icons are generated with `node scripts/generate-icons.mjs`.

## Offline use and sync

PocketLedger is offline-first. It keeps working with no connection, in the browser and as an installed app.

- **Device copy.** After each online visit, the app saves your ledger to IndexedDB (`GET /api/sync/snapshot`, ETag-cached). Offline, every screen opens a local view (`/offline?from=<page>`) built from that copy. It covers the dashboard, transactions, details, salary history, monthly report, borrowed money and savings.
- **Same maths.** The server and the device use the same pure functions (`src/lib/ledger/model.ts`, `derive.ts`). That covers FIFO salary funding, carry-forward, period totals and running balances, so the figures match exactly. An integration test compares them. An expense that a salary can't fund is refused offline with the same message the server gives.
- **Outbox.** Adds, edits, deletes and "mark paid" made offline go into an IndexedDB queue. Each one has a unique `opId`, and new records also have a `clientRef`. An entry stays queued until the server confirms it (`POST /api/sync/push`). It survives reloads, restarts and crashes. Sync runs in order, one tab at a time (Web Locks), when the connection returns, when the app regains focus, and on a backoff timer.
- **No duplicates.** The server records every applied `opId` (`SyncOp`) and enforces a unique `clientRef` per user. A retried request returns the original result and is never applied twice.
- **Weak connections count as offline.** The phone can report a connection that isn't getting through, such as weak mobile data or Wi-Fi with no internet, and the browser then still says "online". Time limits cover this case. A normal save that gets no answer within 10 s is queued on the device instead. That save and its queued copy share the same `clientRef`/`opId`, so a save that arrives late is still stored only once. A page that doesn't load within 8 s, or 2.5 s just after a failure, opens the offline app. Sync requests time out too, and sync retries every 15–60 s until the server answers.
- **No silent overwrites.** Edits and deletes carry the version they were based on. If the record changed on another device in the meantime, the change is held as a conflict. The sync indicator then lets you choose **Keep mine** or **Keep the server's**.
- **Sync indicator** (cloud icon in the header) shows online/offline status, the number of waiting changes, sync in progress, the last successful sync, and conflicts or refused changes with Retry / Discard.
- **Online-only:** managing categories, people, savings goals, bills, savings deposits/withdrawals and settings. All of these can still be viewed offline.
- **Privacy:** signing out syncs what it can, asks before discarding unsynced changes, and then wipes the device copy.

The service worker (`public/sw.js`) precaches the offline app and its assets and caches content-hashed build files. It never caches financial pages or API responses. Those live only in IndexedDB.

## Project layout

```text
src/
  app/(auth)/            login, first-run setup
  app/(app)/             dashboard and all pages (static shell + streamed data)
  app/actions/           server actions (auth + ledger mutations)
  app/api/               CSV exports, import template
  lib/ledger/            shared ledger model (server + device), FIFO allocator, recompute engine
  lib/offline/           IndexedDB store, outbox + sync engine, local views (browser)
  lib/sync/              sync protocol types
  lib/services/          finance, salary, transactions, people, bills, savings, alerts, import
  lib/alerts/            pure alert rules
  lib/db/                Mongoose connection + models
  components/            UI (forms, charts, shell)
tests/                   unit + integration tests
```
