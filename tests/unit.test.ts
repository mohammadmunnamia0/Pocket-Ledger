import { describe, expect, it } from "vitest";
import { formatTaka, parseTaka, percent, sum } from "@/lib/money";
import { addDays, addMonths, daysBetween, formatDate, isISODate, monthEnd, todayISO } from "@/lib/dates";
import { allocateFifo } from "@/lib/ledger/fifo";
import { buildAlerts, freeToSave, type AlertContext } from "@/lib/alerts/rules";
import { expenseLines } from "@/lib/services/finance";

const tk = (n: number) => n * 100;

describe("money", () => {
  it("parses taka input into integer poisha", () => {
    expect(parseTaka("1,200")).toBe(120000);
    expect(parseTaka("৳ 570.5")).toBe(57050);
    expect(parseTaka("0.01")).toBe(1);
    expect(parseTaka("১২০০")).toBe(120000);
    expect(parseTaka("12.345")).toBeNull();
    expect(parseTaka("abc")).toBeNull();
  });

  it("avoids floating point drift", () => {
    // 0.1 + 0.2 style errors cannot happen with integer poisha
    expect(sum([parseTaka("0.10")!, parseTaka("0.20")!])).toBe(parseTaka("0.30"));
    expect(sum(Array(1000).fill(parseTaka("0.07")!))).toBe(tk(70));
  });

  it("formats with Bangladeshi digit grouping", () => {
    expect(formatTaka(tk(20000))).toBe("৳20,000");
    expect(formatTaka(tk(1234567))).toBe("৳12,34,567");
    expect(formatTaka(123456789)).toBe("৳12,34,567.89");
    expect(formatTaka(-tk(500))).toBe("-৳500");
    expect(formatTaka(tk(500), { signed: true })).toBe("+৳500");
    expect(percent(tk(75), tk(100))).toBe(75);
  });
});

describe("dates", () => {
  it("works in Dhaka calendar dates", () => {
    // 2026-10-31 20:00 UTC is already 1 Nov in Dhaka (UTC+6)
    expect(todayISO(new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-01");
    expect(formatDate("2026-10-28")).toBe("28 Oct 2026");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(daysBetween("2027-02-15", "2027-03-15")).toBe(28);
    expect(isISODate("2027-02-30")).toBe(false);
  });
});

describe("FIFO allocator", () => {
  const jan = { id: "jan", date: "2027-01-01", seq: 1, amount: tk(20000) };
  const feb = { id: "feb", date: "2027-02-15", seq: 2, amount: tk(20000) };

  it("Test 1 & 2: carries forward and funds across salaries oldest-first", () => {
    const janSpend = { id: "e1", date: "2027-01-20", seq: 3, amount: tk(15000) };
    const big = { id: "e2", date: "2027-02-16", seq: 4, amount: tk(8000) };
    const r = allocateFifo([feb, jan], [big, janSpend]);
    expect(r.shortfalls).toEqual([]);
    expect(r.allocations.filter((a) => a.consumerId === "e2")).toEqual([
      { consumerId: "e2", sourceId: "jan", amount: tk(5000) },
      { consumerId: "e2", sourceId: "feb", amount: tk(3000) },
    ]);
    expect(r.remaining.get("jan")).toBe(0);
    expect(r.remaining.get("feb")).toBe(tk(17000));
  });

  it("never funds an expense with money received later", () => {
    const r = allocateFifo([feb], [{ id: "early", date: "2027-02-01", seq: 1, amount: tk(100) }]);
    expect(r.shortfalls).toHaveLength(1);
    expect(r.allocations).toHaveLength(0);
  });

  it("Test 7: reports insufficient funds instead of going negative", () => {
    const r = allocateFifo([{ id: "s", date: "2027-01-01", seq: 1, amount: tk(1000) }], [{ id: "x", date: "2027-01-02", seq: 2, amount: tk(1500) }]);
    expect(r.shortfalls[0]).toMatchObject({ consumerId: "x", required: tk(1500), funded: tk(1000) });
    expect(r.remaining.get("s")).toBe(0);
  });

  it("honours a manual funding override before falling back to FIFO", () => {
    const r = allocateFifo([jan, feb], [{ id: "x", date: "2027-02-20", seq: 9, amount: tk(21000), preferredSourceId: "feb" }]);
    expect(r.allocations).toEqual([
      { consumerId: "x", sourceId: "feb", amount: tk(20000) },
      { consumerId: "x", sourceId: "jan", amount: tk(1000) },
    ]);
  });

  it("respects amounts already used by earlier allocations", () => {
    const r = allocateFifo([jan, feb], [{ id: "x", date: "2027-02-20", seq: 9, amount: tk(6000) }], new Map([["jan", tk(15000)]]));
    expect(r.allocations).toEqual([
      { consumerId: "x", sourceId: "jan", amount: tk(5000) },
      { consumerId: "x", sourceId: "feb", amount: tk(1000) },
    ]);
  });
});

describe("expense breakdown lines", () => {
  it("uses items instead of the parent so nothing is double counted", () => {
    const lines = expenseLines({
      amount: tk(3100),
      categoryId: null,
      items: [
        { amount: tk(2000) },
        { amount: tk(300) },
        { amount: tk(500) },
        { amount: tk(300) },
      ] as never,
    });
    expect(sum(lines.map((l) => l.amount))).toBe(tk(3100));
    expect(lines).toHaveLength(4);
  });
});

describe("smart alerts", () => {
  const base: AlertContext = {
    today: "2026-11-20",
    month: "2026-11",
    spendable: tk(8000),
    pendingTotal: 0,
    upcomingBillsTotal: tk(3000),
    upcomingBillsCount: 2,
    nextBill: { title: "Internet", dueDate: "2026-11-25" },
    familyOpen: [],
    cycle: { label: "November Salary", start: "2026-11-01", totalAvailable: tk(25000), totalSpent: tk(20000) },
    categoryCompare: [{ name: "Transport", current: tk(3000), previous: tk(1500) }],
    goals: [{ id: "g", name: "Medical", kind: "medical", status: "active", balance: tk(3000), targetAmount: tk(30000), monthlyTarget: 0, thisMonthDeposits: 0 }],
    lastMonth: { month: "2026-10", saved: tk(2000) },
    prefs: { enabled: {}, minBalance: tk(2000), spendWarnPct: 75, savingsReminderDay: 0 },
  };

  it("never suggests saving money committed to bills, pending items or family", () => {
    const ctx = { ...base, pendingTotal: tk(1000), familyOpen: [{ personName: "Suraiya", remaining: tk(2000) }] };
    expect(freeToSave(ctx)).toBe(tk(8000 - 1000 - 3000 - 2000 - 2000));
    const alerts = buildAlerts(ctx);
    expect(alerts.find((a) => a.type === "savings_opportunity")).toBeUndefined();
  });

  it("generates data-driven alerts with stable period keys", () => {
    const alerts = buildAlerts(base);
    const types = alerts.map((a) => a.type);
    expect(types).toContain("high_spend");
    expect(types).toContain("medical");
    expect(types).toContain("category_increase");
    expect(types).toContain("bills");
    expect(types).toContain("achievement");
    expect(alerts.find((a) => a.type === "medical")?.priority).toBe("high");
    expect(alerts.find((a) => a.type === "high_spend")?.key).toBe("high_spend:2026-11-01:75");
    expect(buildAlerts(base).map((a) => a.key)).toEqual(alerts.map((a) => a.key));
  });

  it("raises a high-priority alert when commitments exceed the balance", () => {
    const alerts = buildAlerts({ ...base, spendable: tk(1000) });
    expect(alerts[0]).toMatchObject({ type: "low_balance", priority: "high" });
  });

  it("respects disabled alert types", () => {
    const alerts = buildAlerts({ ...base, prefs: { ...base.prefs, enabled: { medical: false, high_spend: false } } });
    expect(alerts.some((a) => a.type === "medical" || a.type === "high_spend")).toBe(false);
  });
});
