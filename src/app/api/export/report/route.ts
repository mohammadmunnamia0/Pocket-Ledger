import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getPeriodReport } from "@/lib/services/finance";
import { parseReportParams } from "@/lib/report-params";
import { csvResponse, toCsv } from "@/lib/csv";
import { toInputValue } from "@/lib/money";
import { TXN_TYPE_LABELS } from "@/lib/labels";

/** Period report as CSV: summary, category totals and the transactions. Opens in Excel. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { from, to, filters } = parseReportParams(Object.fromEntries(request.nextUrl.searchParams));
  const r = await getPeriodReport(user.id, from, to, filters);
  const t = toInputValue;

  const rows: unknown[][] = [
    ["PocketLedger report", `${from} to ${to}`],
    [],
    ["Summary", "Amount (BDT)"],
    ["Opening balance", t(r.openingBalance)],
    ["Salary", t(r.salary)],
    ["Additional income", t(r.additionalIncome)],
    ["Opening balance entries", t(r.broughtIn)],
    ["Total available balance", t(r.totalAvailable)],
    ["Expenses", t(r.expenses)],
    ["Investments", t(r.investments)],
    ["Savings deposits", t(r.savingsDeposits)],
    ["Savings withdrawals", t(r.savingsWithdrawals)],
    ["Total outflows", t(r.totalOutflows)],
    ["Closing balance", t(r.closingBalance)],
    ["Pending (not deducted)", t(r.pendingTotal)],
    [],
    ["Category", "Sub-category", "Total spent (BDT)"],
  ];
  for (const c of r.categories) {
    rows.push([c.name, "", t(c.total)]);
    for (const ch of c.children) rows.push([c.name, ch.name, t(ch.total)]);
  }
  rows.push([], ["Date", "Title", "Type", "Category", "Status", "Amount (BDT)", "Month", "Notes"]);
  for (const x of r.transactions) {
    rows.push([x.date, x.incomeLabel || x.title, TXN_TYPE_LABELS[x.type], x.categoryLabel ?? "", x.status, t(x.amount), x.attributionMonth, x.notes ?? ""]);
  }
  return csvResponse(toCsv(rows), `report-${from}-to-${to}.csv`);
}
