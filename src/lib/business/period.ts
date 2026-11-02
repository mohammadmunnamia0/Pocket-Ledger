/**
 * Date filters shared by every account: a specific date, a range, a week or a month.
 * Weeks run Saturday → Friday (the working week in Bangladesh).
 */
import { addDays, formatDate, formatMonthLong, isISODate, isMonth, monthEnd, monthStart } from "../dates";

export type PeriodMode = "all" | "date" | "range" | "week" | "month";

export interface PeriodFilter {
  mode: PeriodMode;
  from: string | null;
  to: string | null;
  label: string;
}

/** Saturday on or before `iso`. */
export function weekStart(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(iso, -((day + 1) % 7));
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export function parsePeriod(sp: SP): PeriodFilter {
  const mode = one(sp.period);
  const date = one(sp.date);
  const from = one(sp.from);
  const to = one(sp.to);
  const month = one(sp.month);
  if (mode === "date" && isISODate(date)) return { mode, from: date, to: date, label: formatDate(date) };
  if (mode === "week" && isISODate(date)) {
    const s = weekStart(date);
    const e = addDays(s, 6);
    return { mode, from: s, to: e, label: `Week ${formatDate(s)} – ${formatDate(e)}` };
  }
  if (mode === "month" && isMonth(month)) return { mode, from: monthStart(month), to: monthEnd(month), label: formatMonthLong(month) };
  if (mode === "range" && (isISODate(from) || isISODate(to))) {
    const f = isISODate(from) ? from : null;
    const t = isISODate(to) ? to : null;
    if (f && t && f > t) return { mode, from: t, to: f, label: `${formatDate(t)} – ${formatDate(f)}` };
    return { mode, from: f, to: t, label: `${f ? formatDate(f) : "Start"} – ${t ? formatDate(t) : "today"}` };
  }
  return { mode: "all", from: null, to: null, label: "All time" };
}
