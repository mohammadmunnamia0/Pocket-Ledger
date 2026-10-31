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

The service worker (`public/sw.js`) caches only content-hashed build assets and icons. Pages and financial data are always fetched live and never stored on the device. When there's no connection you get an offline page and a banner instead of stale balances. Icons are generated with `node scripts/generate-icons.mjs`.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in MONGODB_URI and SESSION_SECRET
npm run dev                  # http://localhost:3000
```

On first visit you are sent to `/setup` to create your account. Setup is only possible while no account exists. Default categories and accounts (Cash, Bank Account, Mobile Banking) are created for you.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The database needs to be a **replica set** for multi-document transactions. MongoDB Atlas clusters already are.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests + integration tests (needs `.env.local`; uses a throwaway `pocketledger_test_*` database that it cleans up) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## How the money works

All amounts are stored as **integer poisha** (৳1 = 100 poisha), so there is no floating-point drift. Dates are Asia/Dhaka calendar strings (`YYYY-MM-DD`).

### One ledger

Every movement of money is a `Transaction`:

| Type | Spendable balance | Notes |
| --- | --- | --- |
| `income` (salary / bonus / other / opening) | + | A **funding source** |
| `expense` (paid) | − | A **consumer**; breakdown items replace the parent in reports |
| `expense` (pending) | 0 | Consumes nothing until it is marked paid |
| `savings_deposit` | − | Moves money into a goal; not counted as consumption |
| `savings_withdrawal` | + | Returns money from a goal; a funding source |
| `transfer` | 0 | Moves money between your own accounts only |

No balance is ever stored as an editable number. Balances, salary remainders, report totals and running balances are all computed from these records.

### FIFO salary funding

`src/lib/ledger/fifo.ts` is a pure allocator. For every paid consumer, in date order, it draws from the oldest funding source dated on or before it. If the expense has a manual override, the chosen salary is drawn first. The results are stored in `FundingAllocation` (expense ↔ salary, many-to-many).

When anything changes (a new, edited, back-dated or deleted transaction, or a salary's amount or date), `recomputeFunding` rebuilds allocations from the earliest affected date inside a MongoDB transaction:

- Consumers before that date keep their allocations. They could only have used sources dated before the change.
- If any expense can no longer be fully funded, the whole change is **rejected** with a clear "Insufficient funds" message. No salary ever goes negative.
- If an edit shifts the funding of *other* expenses, the change is written to `AllocationAudit`.
- Each ledger transaction also bumps the user's `ledgerVersion`, so concurrent edits are serialized rather than interleaved.

**Settings → Data integrity** rebuilds the funding ledger from scratch and verifies it.

### Reports

- **Calendar month:** opening = previous closing; total available = opening + income; closing = available − (expenses + net savings/investments). Category spending can be grouped by payment date or by the month the expense belongs to.
- **Salary cycle:** from a salary's received date to the day before the next salary. It shows money carried in, spending funded by this salary vs. previous ones, and what is left. It is built from the funding ledger, so it never double-counts carried-forward money.

## Importing your historical records

Open **Import**, download the template, fill it in, then paste or upload it. The columns are `date, type, title, amount, category, subcategory, payment_method, status, month, person, notes, group, bill_type, recharge_date`.

- **type** is `salary | bonus | income | opening | expense | bill | allocation`.
- **Breakdowns:** rows sharing the same `group` become one expense with items.
- **Money from before your first salary:** add an `opening` row.

The preview shows totals, the calculated closing balance, new categories and people, likely duplicates, and any funding shortfalls. Amounts are never adjusted to make balances match.

## Project layout

```text
src/
  app/(auth)/            login, first-run setup
  app/(app)/             dashboard and all pages (static shell + streamed data)
  app/actions/           server actions (auth + ledger mutations)
  app/api/               CSV exports, import template
  lib/ledger/            FIFO allocator + transactional recompute engine
  lib/services/          finance, salary, transactions, people, bills, savings, alerts, import
  lib/alerts/            pure alert rules
  lib/db/                Mongoose connection + models
  components/            UI (forms, charts, shell)
tests/                   unit + integration tests
```
