import { isObjectId } from "./db/models";
import { TXN_STATUSES, TXN_TYPES, type TxnStatus, type TxnType } from "./constants";
import { isISODate } from "./dates";
import { parsePeriod } from "./business/period";
import type { TxnFilters } from "./services/transactions";

type SP = Record<string, string | string[] | undefined>;

/** Parse and sanitize transaction filters from URL search params. */
export function parseTxnFilters(sp: SP): TxnFilters {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const type = str("type");
  const status = str("status");
  const flow = str("flow");
  // A specific date, week or month (the shared date filter) sets the range.
  const period = parsePeriod(sp);
  const fromPeriod = period.mode === "date" || period.mode === "week" || period.mode === "month";
  return {
    q: str("q")?.slice(0, 100),
    type: TXN_TYPES.includes(type as TxnType) ? (type as TxnType) : undefined,
    status: TXN_STATUSES.includes(status as TxnStatus) ? (status as TxnStatus) : undefined,
    flow: flow === "in" || flow === "out" ? flow : undefined,
    categoryId: isObjectId(str("category")) ? str("category") : undefined,
    personId: isObjectId(str("person")) ? str("person") : undefined,
    from: fromPeriod ? (period.from ?? undefined) : isISODate(str("from")) ? str("from") : undefined,
    to: fromPeriod ? (period.to ?? undefined) : isISODate(str("to")) ? str("to") : undefined,
    page: Math.max(1, Number(str("page")) || 1),
  };
}

