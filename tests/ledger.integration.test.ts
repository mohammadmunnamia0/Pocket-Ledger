/**
 * End-to-end tests of the financial services against a real MongoDB (Atlas replica set,
 * so transactions behave exactly as in production). Each run uses its own throwaway
 * database, dropped afterwards.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "@/lib/db/connect";
import { AllocationAudit, Category, Transaction } from "@/lib/db/models";
import { createUser } from "@/lib/services/setup";
import {
  createTransaction,
  deleteTransaction,
  getTransactionDetail,
  listTransactions,
  markTransactionPaid,
  updateTransaction,
} from "@/lib/services/transactions";
import { getAccountBalances, getBalanceSummary, getMonthReport } from "@/lib/services/finance";
import { getFundingSources, getSalaryCycles, getSalaryFundingHistory } from "@/lib/services/salary";
import { listGoals, moveSavings, saveGoal } from "@/lib/services/savings";
import { getPersonDetail, recordPersonPayment, saveAllocation, savePerson } from "@/lib/services/people";
import { commitImport, previewImport } from "@/lib/services/import";
import { verifyFundingIntegrity } from "@/lib/ledger/engine";
import { getLookups } from "@/lib/services/lookups";
import type { TxnInputRaw } from "@/lib/validation";

const tk = (n: number) => n * 100;
let userId = "";
let counter = 0;

beforeAll(async () => {
  process.loadEnvFile(".env.local");
  process.env.MONGODB_DB = `pocketledger_test_${Date.now()}`;
  await connectDB();
});

afterAll(async () => {
  const db = mongoose.connection.db;
  // The app's DB user may lack dropDatabase; dropping every collection removes the DB too.
  if (db?.databaseName.startsWith("pocketledger_test_")) {
    for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) await db.dropCollection(c.name);
  }
  await disconnectDB();
});

beforeEach(async () => {
  userId = await createUser({ name: "Tester", email: `t${Date.now()}${counter++}@example.test`, password: "password123" });
});

async function salary(amount: number, date: string, label?: string) {
  return createTransaction(userId, { type: "income", title: label ?? "Salary", amount: String(amount), date, incomeKind: "salary", incomeLabel: label });
}

async function expense(title: string, amount: number, date: string, extra: Partial<TxnInputRaw> = {}) {
  return createTransaction(userId, { type: "expense", title, amount: String(amount), date, ...extra });
}

async function source(label: string) {
  const s = (await getFundingSources(userId)).find((x) => x.label === label);
  if (!s) throw new Error(`source ${label} missing`);
  return s;
}

async function expectIntegrity() {
  const report = await verifyFundingIntegrity(userId);
  expect(report.problems).toEqual([]);
}

describe("salary carry-forward and FIFO funding", () => {
  it("Test 1: carries the January remainder into February", async () => {
    await salary(20000, "2027-01-01", "January Salary");
    await expense("Utility Bills", 3000, "2027-01-05");
    await expense("Transport", 2500, "2027-01-08");
    await expense("Groceries", 1200, "2027-01-12");
    await expense("Family Expenses", 3300, "2027-01-20");
    await expense("Other Expenses", 5000, "2027-01-25");
    await salary(20000, "2027-02-15", "February Salary");

    const jan = await source("January Salary");
    expect(jan.used).toBe(tk(15000));
    expect(jan.remaining).toBe(tk(5000));
    expect(jan.carriedForward).toBe(tk(5000));

    const janReport = await getMonthReport(userId, "2027-01");
    expect(janReport.closingBalance).toBe(tk(5000));
    const febReport = await getMonthReport(userId, "2027-02");
    expect(febReport.openingBalance).toBe(tk(5000));
    expect(febReport.totalAvailable).toBe(tk(25000));

    const history = await getSalaryFundingHistory(userId, jan.id);
    expect(history?.expenses.map((e) => e.fundedAmount)).toEqual([tk(3000), tk(2500), tk(1200), tk(3300), tk(5000)]);
    expect(history?.expenses.at(-1)?.remainingAfter).toBe(tk(5000));
    await expectIntegrity();
  });

  it("Test 2: an expense spanning two salaries is split oldest-first", async () => {
    await salary(20000, "2027-01-01", "January Salary");
    await expense("January spend", 15000, "2027-01-20");
    await salary(20000, "2027-02-15", "February Salary");
    const id = await expense("Big purchase", 8000, "2027-02-16");

    const detail = await getTransactionDetail(userId, id);
    expect(detail?.fundedBy.map((f) => [f.title, f.amount])).toEqual([
      ["January Salary", tk(5000)],
      ["February Salary", tk(3000)],
    ]);
    expect((await source("January Salary")).remaining).toBe(0);
    expect((await source("January Salary")).status).toBe("exhausted");
    expect((await source("February Salary")).remaining).toBe(tk(17000));
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(17000));
    await expectIntegrity();
  });

  it("Test 3: after a salary is exhausted, older savings fund later expenses", async () => {
    await salary(20000, "2027-01-01", "January Salary");
    await expense("January spend", 15000, "2027-01-20");
    const feb = await salary(20000, "2027-02-15", "February Salary");
    // Spend the whole February salary explicitly from February.
    await expense("February spending", 20000, "2027-03-01", { fundingSourceId: feb });
    expect((await source("February Salary")).status).toBe("exhausted");
    expect((await source("January Salary")).remaining).toBe(tk(5000));

    const late = await expense("Late month groceries", 3000, "2027-03-05");
    const detail = await getTransactionDetail(userId, late);
    expect(detail?.fundedBy).toEqual([expect.objectContaining({ title: "January Salary", amount: tk(3000) })]);

    // Only ৳2,000 is left — a ৳2,500 expense must be refused, leaving everything untouched.
    const before = await Transaction.countDocuments({ userId });
    await expect(expense("Too much", 2500, "2027-03-08")).rejects.toThrow(/Insufficient funds/);
    expect(await Transaction.countDocuments({ userId })).toBe(before);
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(2000));
    await expectIntegrity();
  });

  it("Test 4: salary cycles follow received dates, independent of calendar months", async () => {
    await salary(20000, "2027-02-15", "February Salary");
    await expense("Feb 20", 1000, "2027-02-20");
    await expense("Mar 05", 2000, "2027-03-05");
    await salary(20000, "2027-03-15", "March Salary");
    await expense("Mar 20", 500, "2027-03-20");

    const cycles = await getSalaryCycles(userId);
    expect(cycles).toHaveLength(2);
    expect(cycles[0]).toMatchObject({ start: "2027-02-15", end: "2027-03-14", totalSpent: tk(3000), fundedByThisSalary: tk(3000), thisSalaryRemaining: tk(17000) });
    expect(cycles[1]).toMatchObject({ start: "2027-03-15", end: null, carriedIn: tk(17000), totalAvailable: tk(37000), totalSpent: tk(500) });
    // FIFO: March-cycle spending is funded by the older February salary first.
    expect(cycles[1].fundedByPrevious).toBe(tk(500));
    expect(cycles[1].unfunded).toBe(0);

    const feb = await getMonthReport(userId, "2027-02");
    const mar = await getMonthReport(userId, "2027-03");
    expect(feb.expenses).toBe(tk(1000));
    expect(mar.expenses).toBe(tk(2500));
    // Same money, two groupings — totals agree, nothing double counted.
    expect(feb.expenses + mar.expenses).toBe(cycles[0].totalSpent + cycles[1].totalSpent);
    expect(mar.closingBalance).toBe(tk(36500));
  });

  it("Test 5: a back-dated expense re-runs FIFO for everything after it and is audited", async () => {
    await salary(20000, "2027-01-01", "January Salary");
    await salary(20000, "2027-02-15", "February Salary");
    await expense("A", 18000, "2027-02-20");
    const b = await expense("B", 4000, "2027-02-21");
    expect((await getTransactionDetail(userId, b))?.fundedBy.map((f) => f.amount)).toEqual([tk(2000), tk(2000)]);

    await expense("Historical", 1000, "2027-01-10");
    expect((await getTransactionDetail(userId, b))?.fundedBy.map((f) => [f.title, f.amount])).toEqual([
      ["January Salary", tk(1000)],
      ["February Salary", tk(3000)],
    ]);
    expect(await AllocationAudit.countDocuments({ userId })).toBeGreaterThan(0);

    const jan = await getMonthReport(userId, "2027-01");
    const feb = await getMonthReport(userId, "2027-02");
    expect(jan.closingBalance).toBe(tk(19000));
    expect(feb.openingBalance).toBe(jan.closingBalance);
    expect(feb.closingBalance).toBe(tk(17000));
    await expectIntegrity();
  });

  it("Test 6: a historical salary slots into chronological order and takes over FIFO", async () => {
    await salary(20000, "2027-01-01", "January Salary");
    const e = await expense("Rent share", 6000, "2027-01-10");
    await salary(10000, "2026-12-01", "December Salary");

    expect((await getTransactionDetail(userId, e))?.fundedBy).toEqual([
      expect.objectContaining({ title: "December Salary", amount: tk(6000) }),
    ]);
    expect((await getFundingSources(userId)).map((s) => s.label)).toEqual(["December Salary", "January Salary"]);
    expect((await source("January Salary")).remaining).toBe(tk(20000));
    await expectIntegrity();
  });

  it("changing a salary's amount or date recalculates — and refuses to strand expenses", async () => {
    const jan = await salary(20000, "2027-01-01", "January Salary");
    await expense("Spend", 15000, "2027-01-10");
    const base = { type: "income" as const, title: "Salary", incomeKind: "salary" as const, incomeLabel: "January Salary" };

    await updateTransaction(userId, jan, { ...base, amount: "16000", date: "2027-01-01" });
    expect((await source("January Salary")).remaining).toBe(tk(1000));

    await expect(updateTransaction(userId, jan, { ...base, amount: "10000", date: "2027-01-01" })).rejects.toThrow(/Insufficient funds/);
    await expect(updateTransaction(userId, jan, { ...base, amount: "16000", date: "2027-01-15" })).rejects.toThrow(/Insufficient funds/);
    await expect(deleteTransaction(userId, jan)).rejects.toThrow(/Insufficient funds/);
    expect((await source("January Salary")).amount).toBe(tk(16000));
    await expectIntegrity();
  });

  it("Test 7: insufficient balance is refused with a clear message", async () => {
    await salary(1000, "2027-01-01");
    await expect(expense("Shoes", 1500, "2027-01-02")).rejects.toThrow(/Insufficient funds: This entry needs ৳1,500 but only ৳1,000/);
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(1000));
  });
});

describe("transactions", () => {
  it("pending expenses do not consume funds until paid", async () => {
    await salary(5000, "2027-01-01");
    const id = await expense("Internet Bill", 1000, "2027-01-05", { status: "pending" });
    let bal = await getBalanceSummary(userId, "2027-12-31");
    expect(bal.spendable).toBe(tk(5000));
    expect(bal.pendingTotal).toBe(tk(1000));
    expect((await getTransactionDetail(userId, id))?.fundedBy).toEqual([]);

    await markTransactionPaid(userId, id, "2027-01-07");
    bal = await getBalanceSummary(userId, "2027-12-31");
    expect(bal.spendable).toBe(tk(4000));
    expect(bal.pendingTotal).toBe(0);
    expect((await getTransactionDetail(userId, id))?.txn.date).toBe("2027-01-07");
    await expectIntegrity();
  });

  it("editing and deleting recalculate every balance", async () => {
    await salary(20000, "2027-01-01");
    const id = await expense("Chicken", 1200, "2027-01-05");
    await updateTransaction(userId, id, { type: "expense", title: "Chicken", amount: "1500", date: "2027-01-05" });
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(18500));
    await deleteTransaction(userId, id);
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(20000));
    expect(await Transaction.countDocuments({ userId })).toBe(1);
    await expectIntegrity();
  });

  it("breakdown totals come from items and are never double counted", async () => {
    await salary(20000, "2027-01-01");
    const lookups = await getLookups(userId);
    const cat = (label: string) => lookups.categories.find((c) => c.label === label)!.id;
    const id = await createTransaction(userId, {
      type: "expense",
      title: "New Market Hangout & Shopping",
      amount: "1", // ignored — derived from items
      date: "2027-01-12",
      categoryId: cat("Entertainment & Hangout"),
      items: [
        { name: "Suraiya's Shoes", amount: "2000", categoryId: cat("Personal Expenses › Shopping") },
        { name: "Ammar's Towel", amount: "300", categoryId: cat("Family & Household › Household Shopping") },
        { name: "Transport Cost", amount: "500", categoryId: cat("Transport › Daily Transport") },
        { name: "Tea Treat", amount: "300" },
      ],
    });
    const t = await Transaction.findById(id).lean();
    expect(t?.amount).toBe(tk(3100));

    const report = await getMonthReport(userId, "2027-01");
    expect(report.expenses).toBe(tk(3100));
    expect(report.categories.reduce((s, c) => s + c.total, 0)).toBe(tk(3100));
    expect(report.categories.find((c) => c.name === "Personal Expenses")?.total).toBe(tk(2000));
    expect(report.categories.find((c) => c.name === "Entertainment & Hangout")?.total).toBe(tk(300));
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(16900));
  });

  it("transfers between own accounts change account balances only", async () => {
    await salary(10000, "2027-01-01");
    const { accounts } = await getLookups(userId);
    const cash = accounts.find((a) => a.name === "Cash")!.id;
    const bank = accounts.find((a) => a.name === "Bank Account")!.id;
    await createTransaction(userId, { type: "transfer", title: "ATM deposit", amount: "4000", date: "2027-01-02", accountId: cash, toAccountId: bank });

    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(10000));
    const balances = await getAccountBalances(userId);
    expect(balances.get(cash)).toBe(tk(6000));
    expect(balances.get(bank)).toBe(tk(4000));
    const report = await getMonthReport(userId, "2027-01");
    expect(report.expenses).toBe(0);
    expect(report.totalIncome).toBe(tk(10000));
  });

  it("history shows the true running balance after every transaction", async () => {
    await salary(20000, "2027-01-01");
    await expense("A", 1000, "2027-01-02");
    await expense("B", 500, "2027-01-03", { status: "pending" });
    await expense("C", 2000, "2027-01-04");
    const list = await listTransactions(userId, {});
    expect(list.rows.map((r) => [r.title, r.runningBalance])).toEqual([
      ["C", tk(17000)],
      ["B", tk(19000)],
      ["A", tk(19000)],
      ["Salary", tk(20000)],
    ]);
    const filtered = await listTransactions(userId, { q: "A", type: "expense" });
    expect(filtered.rows[0].runningBalance).toBe(tk(19000));
  });

  it("month closings chain into the next month's opening", async () => {
    await salary(20000, "2026-07-01");
    await expense("Jul", 12200, "2026-07-20");
    await salary(20000, "2026-08-01");
    await expense("Aug", 15000, "2026-08-20");
    await salary(20000, "2026-09-01");
    await expense("Sep", 9000, "2026-09-20");
    const jul = await getMonthReport(userId, "2026-07");
    const aug = await getMonthReport(userId, "2026-08");
    const sep = await getMonthReport(userId, "2026-09");
    expect(jul.closingBalance).toBe(tk(7800));
    expect(aug.openingBalance).toBe(tk(7800));
    expect(aug.totalAvailable).toBe(tk(27800));
    expect(aug.closingBalance).toBe(sep.openingBalance);
    expect(sep.closingBalance).toBe(tk(23800));
  });
});

describe("savings and allocations", () => {
  it("savings deposits are reserved, not spent, and withdrawals are capped", async () => {
    await salary(10000, "2027-01-01");
    const goal = await saveGoal(userId, { name: "Medical Emergency Fund", kind: "medical", targetAmount: "30000", priority: "high" });
    await moveSavings(userId, { goalId: goal, direction: "deposit", amount: "2000", date: "2027-01-05" });

    let bal = await getBalanceSummary(userId, "2027-12-31");
    expect(bal.spendable).toBe(tk(8000));
    expect(bal.savings).toBe(tk(2000));
    const report = await getMonthReport(userId, "2027-01");
    expect(report.expenses).toBe(0);
    expect(report.savingsDeposits).toBe(tk(2000));

    await expect(moveSavings(userId, { goalId: goal, direction: "withdraw", amount: "3000", date: "2027-01-06" })).rejects.toThrow(/exceeds the fund balance/);
    await expect(moveSavings(userId, { goalId: goal, direction: "withdraw", amount: "500", date: "2027-01-04" })).rejects.toThrow(/exceeds the fund balance/);
    await moveSavings(userId, { goalId: goal, direction: "withdraw", amount: "500", date: "2027-01-06" });

    bal = await getBalanceSummary(userId, "2027-12-31");
    expect(bal.spendable).toBe(tk(8500));
    expect(bal.savings).toBe(tk(1500));
    const [g] = await listGoals(userId, "2027-12-31");
    expect(g).toMatchObject({ balance: tk(1500), remainingTarget: tk(28500), progressPct: 5 });
    await expectIntegrity();
  });

  it("allocations are commitments; only payments move cash", async () => {
    await salary(20000, "2026-09-01");
    const person = await savePerson(userId, { name: "Suraiya", monthlyAllocation: "2500" });
    await saveAllocation(userId, { personId: person, month: "2026-09", amount: "2500" });
    await saveAllocation(userId, { personId: person, month: "2026-10", amount: "2500" });
    await saveAllocation(userId, { personId: person, month: "2026-11", amount: "2000" });
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(20000));

    await recordPersonPayment(userId, { personId: person, amount: "2500", date: "2026-09-05", month: "2026-09" });
    await recordPersonPayment(userId, { personId: person, amount: "1000", date: "2026-10-05", month: "2026-10" });
    const detail = await getPersonDetail(userId, person);
    expect(detail?.totals).toMatchObject({ allocated: tk(7000), paid: tk(3500) });
    expect(detail?.allocations.find((a) => a.month === "2026-10")?.remaining).toBe(tk(1500));
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(16500));
  });
});

describe("historical import", () => {
  const rows = [
    { date: "2026-07-01", type: "opening", title: "Balance before tracking", amount: "1000" },
    { date: "2026-07-05", type: "salary", title: "July 2026 Salary", amount: "20000", month: "2026-07" },
    { date: "2026-07-06", type: "expense", title: "Chicken", amount: "1,200", category: "Food & Groceries", subcategory: "Chicken" },
    { date: "2026-07-08", type: "bill", title: "Electricity recharge", amount: "1000", month: "2026-08", bill_type: "electricity", recharge_date: "2026-07-08" },
    { date: "2026-07-12", type: "expense", title: "Shoes", amount: "2000", category: "Personal Expenses", group: "New Market" },
    { date: "2026-07-12", type: "expense", title: "Tea", amount: "300", category: "Entertainment & Hangout > Treat", group: "New Market" },
    { date: "2026-07-15", type: "expense", title: "Gym", amount: "800", category: "Fitness" },
    { type: "allocation", amount: "2500", month: "2026-09", person: "Suraiya" },
  ];

  it("previews totals and inconsistencies, then commits atomically", async () => {
    const preview = await previewImport(userId, rows);
    expect(preview.canCommit).toBe(true);
    expect(preview.totals).toMatchObject({ income: tk(21000), expenses: tk(5300), allocations: tk(2500), transactions: 6 });
    expect(preview.closingBalance).toBe(tk(15700));
    expect(preview.newCategories).toContain("Fitness");
    expect(preview.newPersons).toEqual(["Suraiya"]);
    expect(preview.entries.find((e) => e.title === "New Market")).toMatchObject({ amount: tk(2300), itemCount: 2 });

    const res = await commitImport(userId, rows);
    expect(res).toMatchObject({ transactions: 6, allocations: 1 });
    expect((await getBalanceSummary(userId, "2027-12-31")).spendable).toBe(tk(15700));
    const aug = await getMonthReport(userId, "2026-08", { basis: "attribution" });
    expect(aug.categories.find((c) => c.name === "Utility Bills")?.total).toBe(tk(1000));
    expect(await Category.exists({ userId, name: "Fitness" })).toBeTruthy();
    await expectIntegrity();

    // Re-importing flags duplicates instead of silently adding them.
    const again = await previewImport(userId, rows);
    expect(again.entries.filter((e) => e.warnings.length > 0).length).toBeGreaterThan(0);
  });

  it("refuses imports whose expenses exceed recorded income, without changing amounts", async () => {
    const preview = await previewImport(userId, [
      { date: "2026-07-05", type: "salary", amount: "1000" },
      { date: "2026-07-06", type: "expense", title: "Big", amount: "5000", category: "Others" },
      { date: "2026-07-06", type: "expense", title: "Bad", amount: "abc", category: "Others" },
    ]);
    expect(preview.canCommit).toBe(false);
    expect(preview.issues[0]).toMatch(/Insufficient funds/);
    expect(preview.entries[2].errors[0]).toMatch(/Invalid amount/);
    await expect(commitImport(userId, [{ date: "2026-07-05", type: "salary", amount: "1000" }, { date: "2026-07-06", type: "expense", title: "Big", amount: "5000" }])).rejects.toThrow();
    expect(await Transaction.countDocuments({ userId })).toBe(0);
  });
});

describe("offline copy uses identical calculations", () => {
  it("the shared model on the device snapshot reproduces every server figure", async () => {
    const { todayISO, addDays, monthOf } = await import("@/lib/dates");
    const { getSnapshot } = await import("@/lib/services/sync");
    const { getDashboard } = await import("@/lib/services/dashboard");
    const { computeDashboardFigures, computeAllocations, runningBalances } = await import("@/lib/ledger/model");
    const { FundingAllocation } = await import("@/lib/db/models");
    const today = todayISO();
    const d = (n: number) => addDays(today, -n);
    const lookups = await getLookups(userId);
    const cat = (label: string) => lookups.categories.find((c) => c.label === label)!.id;

    await createTransaction(userId, { type: "income", title: "Opening", amount: "1500", date: d(70), incomeKind: "opening" });
    await salary(20000, d(60), "Older Salary");
    await expense("Rent", 9000, d(55), { categoryId: cat("Family & Household") });
    await salary(20000, d(30), "Previous Salary");
    await createTransaction(userId, {
      type: "expense", title: "Market", date: d(28), categoryId: cat("Food & Groceries"),
      items: [{ name: "Fish", amount: "800", categoryId: cat("Food & Groceries › Fish") }, { name: "Bus", amount: "200", categoryId: cat("Transport") }],
    });
    await expense("Investment", 5570, d(25), { categoryId: cat("Investment & Savings › Investment") });
    const person = await savePerson(userId, { name: "Suraiya" });
    await saveAllocation(userId, { personId: person, month: monthOf(d(20)), amount: "2500" });
    await recordPersonPayment(userId, { personId: person, amount: "1000", date: d(20), month: monthOf(d(20)) });
    await salary(20000, d(10), "Latest Salary");
    await createTransaction(userId, { type: "income", title: "Bonus", amount: "3000", date: d(8), incomeKind: "bonus" });
    const goal = await saveGoal(userId, { name: "Medical", kind: "medical", targetAmount: "30000", priority: "high" });
    await moveSavings(userId, { goalId: goal, direction: "deposit", amount: "2000", date: d(5) });
    await expense("Internet", 1000, d(3), { status: "pending" });
    await expense("Tea", 30, today);

    const snap = await getSnapshot(userId);
    const device = computeDashboardFigures({
      txns: snap.transactions,
      lookups: snap.lookups,
      persons: snap.lookups.persons,
      personAllocations: snap.personAllocations,
      today,
    });
    const server = await getDashboard(userId);

    expect(device.period).toEqual(server.period);
    expect(device.metrics).toEqual(server.metrics);
    expect(device.borrowed).toEqual(server.borrowed);
    expect(device.salaryBreakdown).toEqual(server.salary.breakdown);
    expect(server.period).toMatchObject({ label: "Latest Salary", otherIncome: tk(3000) });

    // FIFO derived on the device equals the funding ledger stored on the server.
    const key = (a: { consumerId: string; sourceId: string; amount: number }) => `${a.consumerId}>${a.sourceId}:${a.amount}`;
    const stored = (await FundingAllocation.find({ userId }).lean()).map((a) => key({ consumerId: a.consumerId.toString(), sourceId: a.sourceId.toString(), amount: a.amount }));
    expect(computeAllocations(snap.transactions).allocations.map(key).sort()).toEqual(stored.sort());

    // Running balances match the server's transaction history.
    const list = await listTransactions(userId, { pageSize: 200 });
    const balances = runningBalances(snap.transactions);
    for (const row of list.rows) expect(balances.get(row.id)).toBe(row.runningBalance);
  });
});

describe("offline sync", () => {
  const payload = (title: string, amount: string, date: string) => ({ type: "expense" as const, title, amount, date });

  it("never duplicates on retries, protects newer data, and keeps rejected changes retryable", async () => {
    const { applyOperation } = await import("@/lib/services/sync");
    await salary(5000, "2027-01-01");

    // Same op replayed, and the same new record sent under a different op id → one record.
    const c1 = await applyOperation(userId, { opId: "op-create-0001", kind: "create", clientRef: "dev-ref-0001", payload: payload("Tea", "50", "2027-01-02") });
    const c2 = await applyOperation(userId, { opId: "op-create-0001", kind: "create", clientRef: "dev-ref-0001", payload: payload("Tea", "50", "2027-01-02") });
    const c3 = await applyOperation(userId, { opId: "op-create-0002", kind: "create", clientRef: "dev-ref-0001", payload: payload("Tea", "50", "2027-01-02") });
    expect(c1.status).toBe("applied");
    expect(c2).toEqual(c1);
    expect(c3).toMatchObject({ status: "applied", txnId: (c1 as { txnId: string }).txnId });
    expect(await Transaction.countDocuments({ userId, title: "Tea" })).toBe(1);

    const id = (c1 as { txnId: string }).txnId;
    const base = (await getTransactionDetail(userId, id))!.txn.updatedAt;

    // Edited on "another device" → the offline edit made from the old version is a conflict.
    await updateTransaction(userId, id, payload("Tea (other device)", "60", "2027-01-02"));
    const stale = await applyOperation(userId, { opId: "op-update-001", kind: "update", txnId: id, baseUpdatedAt: base, payload: payload("Tea", "70", "2027-01-02") });
    expect(stale.status).toBe("conflict");
    expect((await getTransactionDetail(userId, id))!.txn.title).toBe("Tea (other device)");

    // "Keep mine" forces it; replaying the forced op is recognised and changes nothing.
    const forced = await applyOperation(userId, { opId: "op-update-002", kind: "update", txnId: id, baseUpdatedAt: base, payload: payload("Tea", "70", "2027-01-02"), force: true });
    expect(forced.status).toBe("applied");
    await import("@/lib/db/models").then(({ SyncOp }) => SyncOp.deleteOne({ userId, opId: "op-update-002" })); // simulate a lost confirmation
    const replay = await applyOperation(userId, { opId: "op-update-002", kind: "update", txnId: id, baseUpdatedAt: base, payload: payload("Tea", "70", "2027-01-02") });
    expect(replay.status).toBe("applied");
    expect((await getTransactionDetail(userId, id))!.txn.amount).toBe(tk(70));

    // Deletes: stale → conflict; current → applied; repeated → still applied.
    expect((await applyOperation(userId, { opId: "op-delete-001", kind: "delete", txnId: id, baseUpdatedAt: base })).status).toBe("conflict");
    const fresh = (await getTransactionDetail(userId, id))!.txn.updatedAt;
    expect((await applyOperation(userId, { opId: "op-delete-002", kind: "delete", txnId: id, baseUpdatedAt: fresh })).status).toBe("applied");
    expect((await applyOperation(userId, { opId: "op-delete-003", kind: "delete", txnId: id, baseUpdatedAt: fresh })).status).toBe("applied");
    expect(await Transaction.countDocuments({ userId, title: "Tea" })).toBe(0);

    // Not enough money → rejected, nothing saved, and the same op succeeds once income exists.
    const big = { opId: "op-create-big1", kind: "create" as const, clientRef: "dev-ref-big1", payload: payload("Phone", "9000", "2027-01-05") };
    expect(await applyOperation(userId, big)).toMatchObject({ status: "rejected" });
    expect(await Transaction.countDocuments({ userId, title: "Phone" })).toBe(0);
    await salary(20000, "2027-01-04");
    expect(await applyOperation(userId, big)).toMatchObject({ status: "applied" });
    expect(await Transaction.countDocuments({ userId, title: "Phone" })).toBe(1);
    await expectIntegrity();
  });
});
