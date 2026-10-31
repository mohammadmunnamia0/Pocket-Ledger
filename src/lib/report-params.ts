import { isObjectId } from "./db/models";
import { addMonths, currentMonth, isISODate, isMonth, monthEnd, monthStart } from "./dates";
import type { ReportFilters } from "./services/finance";

type SP = Record<string, string | string[] | undefined>;

/** Resolve report period + filters from URL params (shared by the page and CSV export). */
export function parseReportParams(sp: SP) {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const thisMonth = currentMonth();
  const month = isMonth(str("month")) ? str("month")! : thisMonth;
  let from = monthStart(month);
  let to = monthEnd(month);
  let label: string | null = null;
  if (str("period") === "custom") {
    const f = str("from");
    const t = str("to");
    from = isISODate(f) ? f : monthStart(addMonths(thisMonth, -2));
    to = isISODate(t) ? t : monthEnd(thisMonth);
    if (from > to) [from, to] = [to, from];
    label = "custom";
  }
  const status = str("status");
  const filters: ReportFilters = {
    basis: str("basis") === "attribution" ? "attribution" : "payment",
    categoryId: isObjectId(str("category")) ? str("category") : undefined,
    personId: isObjectId(str("person")) ? str("person") : undefined,
    status: status === "paid" || status === "pending" ? status : undefined,
  };
  return { month, from, to, custom: label === "custom", filters, thisMonth };
}
