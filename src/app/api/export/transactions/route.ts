import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { listTransactions } from "@/lib/services/transactions";
import { getLookups } from "@/lib/services/lookups";
import { parseTxnFilters } from "@/lib/filters";
import { csvResponse, toCsv } from "@/lib/csv";
import { todayISO } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS, TXN_TYPE_LABELS } from "@/lib/labels";
import { toInputValue } from "@/lib/money";
import { IN_TYPES, OUT_TYPES } from "@/lib/constants";

/** Transaction history as CSV, honouring the same filters as the history page. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const filters = parseTxnFilters(Object.fromEntries(request.nextUrl.searchParams));
  const lookups = await getLookups(user.id);

  const rows: unknown[][] = [["Date", "Title", "Type", "Category", "Amount (BDT)", "Signed amount", "Payment method", "Status", "Month", "Person", "Running balance", "Notes"]];
  for (let page = 1; ; page++) {
    const list = await listTransactions(user.id, { ...filters, page, pageSize: 200 }, lookups);
    for (const t of list.rows) {
      const sign = IN_TYPES.includes(t.type) ? 1 : OUT_TYPES.includes(t.type) ? -1 : 0;
      rows.push([
        t.date,
        t.incomeLabel || t.title,
        TXN_TYPE_LABELS[t.type],
        t.categoryLabel ?? "",
        toInputValue(t.amount),
        t.status === "paid" ? toInputValue(sign * t.amount) : "0",
        PAYMENT_METHOD_LABELS[t.paymentMethod],
        t.status,
        t.attributionMonth,
        t.personName ?? "",
        toInputValue(t.runningBalance ?? 0),
        t.notes ?? "",
      ]);
    }
    if (page >= list.pages) break;
  }
  return csvResponse(toCsv(rows), `transactions-${todayISO()}.csv`);
}
