/**
 * Money is always stored and computed as integer poisha (1 Taka = 100 poisha).
 * Integer arithmetic keeps every sum exact — no floating-point drift.
 */
export type Poisha = number;

const BANGLA_DIGITS = /[০-৯]/g;

/** Parse user input ("1,250.50", "৳ 500", "১২০০") into poisha. Returns null when invalid. */
export function parseTaka(input: string | number | null | undefined): Poisha | null {
  if (input === null || input === undefined) return null;
  const raw = String(input)
    .trim()
    .replace(BANGLA_DIGITS, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/^tk\.?/i, "")
    .replace(/[,\s৳]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  const value = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return null;
  return match[1] ? -value : value;
}

/** Group digits the Bangladeshi way: 12,34,567 */
function groupBD(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

export interface FormatOptions {
  /** Prefix with ৳ (default true) */
  symbol?: boolean;
  /** Show "+" for positive amounts */
  signed?: boolean;
  /** Always show two decimals instead of only when there are poisha */
  fixed?: boolean;
}

export function formatTaka(poisha: Poisha, opts: FormatOptions = {}): string {
  const { symbol = true, signed = false, fixed = false } = opts;
  const negative = poisha < 0;
  const abs = Math.abs(Math.trunc(poisha));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const fracPart = frac !== 0 || fixed ? `.${String(frac).padStart(2, "0")}` : "";
  const sign = negative ? "-" : signed && poisha > 0 ? "+" : "";
  return `${sign}${symbol ? "৳" : ""}${groupBD(String(whole))}${fracPart}`;
}

/** Compact form for chart axes: ৳12.5k, ৳1.2L */
export function formatTakaCompact(poisha: Poisha): string {
  const taka = poisha / 100;
  const abs = Math.abs(taka);
  if (abs >= 100000) return `৳${(taka / 100000).toFixed(abs >= 1000000 ? 0 : 1)}L`;
  if (abs >= 1000) return `৳${(taka / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `৳${Math.round(taka)}`;
}

/** Value for an <input> field, without grouping separators. */
export function toInputValue(poisha: Poisha | null | undefined): string {
  if (poisha === null || poisha === undefined) return "";
  const abs = Math.abs(poisha);
  const frac = abs % 100;
  const body = `${Math.floor(abs / 100)}${frac ? `.${String(frac).padStart(2, "0")}` : ""}`;
  return poisha < 0 ? `-${body}` : body;
}

export function sum(values: Iterable<Poisha>): Poisha {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Integer percentage (0–100+) of part over whole; 0 when whole is 0. */
export function percent(part: Poisha, whole: Poisha): number {
  if (whole <= 0) return 0;
  return Math.round((part * 100) / whole);
}

/** Round poisha down to a whole multiple of `step` taka (used for savings suggestions). */
export function roundDownTaka(poisha: Poisha, stepTaka: number): Poisha {
  const step = stepTaka * 100;
  return Math.floor(poisha / step) * step;
}
