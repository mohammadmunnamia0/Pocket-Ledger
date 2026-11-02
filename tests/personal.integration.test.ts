/**
 * Phase 1 personal-finance features against a real MongoDB (throwaway database):
 * Bank / Cash / Mobile Banking split, lending, borrowing and investments. The examples are
 * the ones from the specification, so the expected figures can be checked by hand.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "@/lib/db/connect";
import { Account, Loan, Transaction } from "@/lib/db/models";
import { createUser } from "@/lib/services/setup";
import { createTransaction, deleteTransaction, updateTransaction } from "@/lib/services/transactions";
import { getBalanceSummary, getMonthReport } from "@/lib/services/finance";
import { getSalaryCycles } from "@/lib/services/salary";
import { getHoldings, setHoldings } from "@/lib/services/holdings";
import { deleteLoan, deleteLoanEntry, getLoan, listLoans, recordLoanRepayment, saveLoan, summarizeLoans } from "@/lib/services/loans";
import { deleteInvestment, listInvestments, recordInvestmentReturn, saveInvestment, setInvestmentValue, summarizeInvestments } from "@/lib/services/investments";
import { applyOperation } from "@/lib/services/sync";
import { verifyFundingIntegrity } from "@/lib/ledger/engine";
import { computeDashboardFigures } from "@/lib/ledger/model";

const tk = (n: number) => n * 100;
const TODAY = "2026-12-31";
let userId = "";
let counter = 0;
let acct: Record<"cash" | "bank" | "mobile", string>;

beforeAll(async () => {
  process.loadEnvFile(".env.local");
  process.env.MONGODB_DB = `pocketledger_test_${Date.now()}`;
  await connectDB();
});

afterAll(async () => {
  const db = mongoose.connection.db;
  if (db?.databaseName.startsWith("pocketledger_test_")) {
    for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) await db.dropCollection(c.name);
  }
  await disconnectDB();
});

beforeEach(async () => {
  userId = await createUser({ name: "Tester", email: `p${Date.now()}${counter++}@example.test`, password: "password123" });
  const accounts = await Account.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();
  const id = (k: string) => accounts.find((a) => a.kind === k)!._id.toString();
  acct = { cash: id("cash"), bank: id("bank"), mobile: id("mobile") };
});

const salary = (amount: number, date: string, accountId = acct.cash) =>
  createTransaction(userId, { type: "income", title: "Salary", amount: String(amount), date, incomeKind: "salary", accountId });
const expense = (title: string, amount: number, date: string, accountId = acct.cash) =>
  createTransaction(userId, { type: "expense", title, amount: String(amount), date, accountId });
const holding = async (kind: "bank" | "cash" | "mobile") => (await getHoldings(userId)).items.find((h) => h.kind === kind)!.amount;
const spendable = async () => (await getBalanceSummary(userId, TODAY)).spendable;
const split = (bank: number, cash: number, mobile: number, notes: Partial<Record<string, string>> = {}) =>
  setHoldings(userId, {
    date: "2026-10-05",
    holdings: [
      { kind: "bank", amount: String(bank), note: notes.bank },
      { kind: "cash", amount: String(cash), note: notes.cash },
      { kind: "mobile", amount: String(mobile), note: notes.mobile },
    ],
  });
async function expectIntegrity() {
  expect((await verifyFundingIntegrity(userId)).problems).toEqual([]);
}

describe("Bank / Cash / Mobile Banking split", () => {
  it("splits ৳15,730 as 8,000 / 3,730 / 4,000 without changing the total, and follows spending, receipts and transfers", async () => {
    await salary(15730, "2026-10-01");
    expect(await holding("cash")).toBe(tk(15730));

    await split(8000, 3730, 4000, { bank: "Emergency money", mobile: "For bills" });
    const h = await getHoldings(userId);
    expect(h.items.map((x) => [x.kind, x.amount])).toEqual([["bank", tk(8000)], ["cash", tk(3730)], ["mobile", tk(4000)]]);
    expect(h.total).toBe(tk(15730));
    expect(h.items.find((x) => x.kind === "bank")!.note).toBe("Emergency money");
    expect(await spendable()).toBe(tk(15730)); // a split is not income or expense
    const report = await getMonthReport(userId, "2026-10");
    expect(report.totalIncome).toBe(tk(15730));
    expect(report.expenses).toBe(0);

    // Rule 1: transfer Bank → Cash ৳2,000: Bank −2,000, Cash +2,000, total unchanged.
    await createTransaction(userId, { type: "transfer", title: "ATM", amount: "2000", date: "2026-10-06", accountId: acct.bank, toAccountId: acct.cash });
    expect([await holding("bank"), await holding("cash")]).toEqual([tk(6000), tk(5730)]);
    expect(await spendable()).toBe(tk(15730));

    // Rule 2: spend ৳500 from Cash: Cash −500, total −500.
    await expense("Groceries", 500, "2026-10-07", acct.cash);
    expect(await holding("cash")).toBe(tk(5230));
    expect(await spendable()).toBe(tk(15230));

    // Rule 3: receive ৳1,000 in Mobile Banking (genuine new income): Mobile +1,000, total +1,000.
    await createTransaction(userId, { type: "income", title: "Freelance", amount: "1000", date: "2026-10-08", incomeKind: "other", accountId: acct.mobile });
    expect(await holding("mobile")).toBe(tk(5000));
    expect(await spendable()).toBe(tk(16230));
    expect((await getHoldings(userId)).total).toBe(await spendable());
    await expectIntegrity();
  });

  it("refuses a split that doesn't add up, with a clear message, and changes nothing", async () => {
    await salary(15730, "2026-10-01");
    await expect(split(8000, 3000, 4000)).rejects.toThrow(/add up to ৳15,000.*৳15,730.*৳730 less/);
    expect(await holding("cash")).toBe(tk(15730));
    expect(await Transaction.countDocuments({ userId, type: "transfer" })).toBe(0);
  });
});

describe("lending", () => {
  it("Rahim example: ৳5,000 lent from Cash, repaid 2,000 then 3,000 — never income or expense", async () => {
    await salary(20000, "2026-10-01");
    const id = await saveLoan(userId, { direction: "lent", person: "Rahim", amount: "5000", date: "2026-10-10", dueDate: "2026-10-20", accountId: acct.cash, note: "Personal Loan" });

    let loan = (await getLoan(userId, id, TODAY))!;
    expect([loan.principal, loan.repaid, loan.outstanding, loan.status]).toEqual([tk(5000), 0, tk(5000), "outstanding"]);
    expect(loan.overdue).toBe(true); // due 20 Oct, nothing repaid by 31 Dec
    expect(await holding("cash")).toBe(tk(15000)); // cash went down
    expect(await spendable()).toBe(tk(15000));
    let report = await getMonthReport(userId, "2026-10");
    expect(report.expenses).toBe(0); // lending is not an expense

    await recordLoanRepayment(userId, id, { amount: "2000", date: "2026-10-15", accountId: acct.cash });
    loan = (await getLoan(userId, id, TODAY))!;
    expect([loan.repaid, loan.outstanding, loan.status]).toEqual([tk(2000), tk(3000), "partial"]);

    await recordLoanRepayment(userId, id, { amount: "3000", date: "2026-10-18", accountId: acct.mobile, interest: "200" });
    loan = (await getLoan(userId, id, TODAY))!;
    expect([loan.repaid, loan.outstanding, loan.status, loan.interest, loan.overdue]).toEqual([tk(5000), 0, "repaid", tk(200), false]);
    expect(await holding("mobile")).toBe(tk(3200));
    expect(await spendable()).toBe(tk(20200));

    report = await getMonthReport(userId, "2026-10");
    expect(report.totalIncome).toBe(tk(20200)); // salary + interest only — repaid principal is not income
    expect(report.expenses).toBe(0);

    const sum = summarizeLoans(await listLoans(userId, TODAY), "lent");
    expect([sum.total, sum.repaid, sum.outstanding, sum.interest]).toEqual([tk(5000), tk(5000), 0, tk(200)]);
    await expectIntegrity();
  });

  it("refuses over-repayment, can't lend money you don't have, and edits/deletes keep balances right", async () => {
    await salary(6000, "2026-10-01");
    await expect(saveLoan(userId, { direction: "lent", person: "Rahim", amount: "9000", date: "2026-10-10", accountId: acct.cash })).rejects.toThrow(/insufficient|not enough/i);
    expect(await Loan.countDocuments({ userId })).toBe(0); // nothing half-saved

    const id = await saveLoan(userId, { direction: "lent", person: "Rahim", amount: "5000", date: "2026-10-10", accountId: acct.cash });
    await recordLoanRepayment(userId, id, { amount: "2000", date: "2026-10-12", accountId: acct.cash });
    await expect(recordLoanRepayment(userId, id, { amount: "3500", date: "2026-10-13", accountId: acct.cash })).rejects.toThrow(/Only 3000/);
    await expect(saveLoan(userId, { direction: "lent", person: "Rahim", amount: "1500", date: "2026-10-10", accountId: acct.cash }, id)).rejects.toThrow(/already been repaid/);

    await saveLoan(userId, { direction: "lent", person: "Rahim K.", amount: "4000", date: "2026-10-10", accountId: acct.cash }, id);
    let loan = (await getLoan(userId, id, TODAY))!;
    expect([loan.person, loan.principal, loan.outstanding]).toEqual(["Rahim K.", tk(4000), tk(2000)]);
    expect(await spendable()).toBe(tk(4000)); // 6,000 − 4,000 + 2,000

    const repayment = loan.entries.find((e) => e.role === "repayment")!;
    await deleteLoanEntry(userId, id, repayment.id);
    loan = (await getLoan(userId, id, TODAY))!;
    expect(loan.outstanding).toBe(tk(4000));

    // Its entries can't be changed from the generic transaction screens or offline sync.
    const principal = loan.entries.find((e) => e.role === "principal")!;
    await expect(deleteTransaction(userId, principal.id)).rejects.toThrow(/Lending & Borrowing/);
    await expect(updateTransaction(userId, principal.id, { type: "loan_out", title: "x", amount: "1", date: "2026-10-10", loanId: id })).rejects.toThrow(/Lending & Borrowing/);
    const r = await applyOperation(userId, { opId: "op-del-loan-1", kind: "delete", txnId: principal.id, baseUpdatedAt: new Date().toISOString(), force: true });
    expect(r.status).toBe("rejected");

    await deleteLoan(userId, id);
    expect(await Transaction.countDocuments({ userId, loanId: { $ne: null } })).toBe(0);
    expect(await spendable()).toBe(tk(6000));
    await expectIntegrity();
  });
});

describe("borrowing", () => {
  it("Karim example: ৳10,000 borrowed into Bank — not salary or income — repaid in parts", async () => {
    await salary(3000, "2026-10-01");
    const id = await saveLoan(userId, { direction: "borrowed", person: "Karim", amount: "10000", date: "2026-10-12", dueDate: "2026-10-30", accountId: acct.bank, note: "Business Funding" });
    expect(await holding("bank")).toBe(tk(10000));
    expect(await spendable()).toBe(tk(13000));

    const report = await getMonthReport(userId, "2026-10");
    expect(report.salary).toBe(tk(3000));
    expect(report.totalIncome).toBe(tk(3000)); // borrowed money is not income

    // The salary period shows it separately from salary and other income.
    const [cycle] = await getSalaryCycles(userId);
    expect([cycle.otherIncome, cycle.otherInflows, cycle.totalAvailable]).toEqual([0, tk(10000), tk(13000)]);

    // Borrowed money can pay for things (FIFO), and is still not income.
    await expense("Laptop", 12000, "2026-10-14", acct.bank);
    expect(await spendable()).toBe(tk(1000));

    await expect(recordLoanRepayment(userId, id, { amount: "4000", date: "2026-10-20", accountId: acct.cash })).rejects.toThrow(/insufficient|not enough/i);
    await createTransaction(userId, { type: "income", title: "Bonus", amount: "6000", date: "2026-10-19", incomeKind: "bonus", accountId: acct.cash });
    await recordLoanRepayment(userId, id, { amount: "4000", date: "2026-10-20", accountId: acct.cash });
    let loan = (await getLoan(userId, id, TODAY))!;
    expect([loan.repaid, loan.outstanding, loan.status]).toEqual([tk(4000), tk(6000), "partial"]);
    expect(await spendable()).toBe(tk(3000));

    // Deleting the borrowed principal would leave the laptop unpaid-for → refused, nothing changes.
    await expect(deleteLoan(userId, id)).rejects.toThrow(/insufficient|not enough/i);
    loan = (await getLoan(userId, id, TODAY))!;
    expect(loan.outstanding).toBe(tk(6000));

    const sum = summarizeLoans(await listLoans(userId, TODAY), "borrowed");
    expect([sum.total, sum.repaid, sum.outstanding]).toEqual([tk(10000), tk(4000), tk(6000)]);
    expect(sum.byPerson).toEqual([{ person: "Karim", outstanding: tk(6000), nextDue: "2026-10-30" }]);
    await expectIntegrity();
  });
});

describe("investments", () => {
  it("৳10,000 business investment from Bank: an asset, not an expense; capital back is not income, profit is", async () => {
    await salary(30000, "2026-10-01", acct.bank);
    const id = await saveInvestment(userId, { name: "Business Investment", kind: "business", amount: "10000", date: "2026-10-15", accountId: acct.bank });
    expect(await holding("bank")).toBe(tk(20000));
    expect(await spendable()).toBe(tk(20000));
    let report = await getMonthReport(userId, "2026-10");
    expect(report.expenses).toBe(0);
    expect(report.investments).toBe(tk(10000));

    let [inv] = await listInvestments(userId);
    expect([inv.invested, inv.stillInvested, inv.profitOrLoss]).toEqual([tk(10000), tk(10000), null]); // unknown without a value

    await setInvestmentValue(userId, id, tk(11500));
    [inv] = await listInvestments(userId);
    expect(inv.profitOrLoss).toBe(tk(1500));

    await recordInvestmentReturn(userId, id, { capital: "4000", profit: "700", date: "2026-11-01", accountId: acct.cash });
    [inv] = await listInvestments(userId);
    expect([inv.capitalReturned, inv.profitReceived, inv.stillInvested]).toEqual([tk(4000), tk(700), tk(6000)]);
    expect(await spendable()).toBe(tk(24700));
    report = await getMonthReport(userId, "2026-11");
    expect(report.totalIncome).toBe(tk(700)); // only the profit is income

    await expect(recordInvestmentReturn(userId, id, { capital: "7000", profit: "0", date: "2026-11-02", accountId: acct.cash })).rejects.toThrow(/Only 6000/);

    const sum = summarizeInvestments(await listInvestments(userId));
    expect([sum.invested, sum.stillInvested, sum.capitalReturned, sum.profitReceived]).toEqual([tk(10000), tk(6000), tk(4000), tk(700)]);

    // Dashboard: the investment counts as invested money, not spending.
    const txns = (await Transaction.find({ userId }).lean()).map((t) => ({ ...t, id: t._id.toString(), incomeKind: t.income?.kind ?? null, incomeLabel: t.income?.label ?? null }));
    const fig = computeDashboardFigures({ txns: txns as never, lookups: { categories: [] }, persons: [], personAllocations: [], today: TODAY });
    expect(fig.metrics.invested).toBe(tk(6000));
    expect(fig.metrics.availableNow).toBe(tk(24700));

    await deleteInvestment(userId, id);
    expect(await spendable()).toBe(tk(30000));
    await expectIntegrity();
  });
});

describe("Remaining balance distribution (Bank / Cash / Mobile Banking)", () => {
  it("13,350 → 10,000 / 3,000 / 350; ৳500 from Cash; ৳5,000 kept in Mobile; salary & carry-forward unchanged", async () => {
    await salary(13350, "2026-10-01");
    const cyclesBefore = await getSalaryCycles(userId);
    await setHoldings(userId, {
      date: "2026-10-02",
      holdings: [
        { kind: "bank", amount: "10000" },
        { kind: "cash", amount: "3000" },
        { kind: "mobile", amount: "350" },
      ],
    });
    // The split only moves money between the three places.
    expect((await getSalaryCycles(userId)).map((c) => [c.totalAvailable, c.totalSpent, c.remainingAtEnd])).toEqual(
      cyclesBefore.map((c) => [c.totalAvailable, c.totalSpent, c.remainingAtEnd]),
    );

    // An expense paid from Cash comes out of Cash only.
    await createTransaction(userId, { type: "expense", title: "Lunch", amount: "500", date: "2026-10-03", paymentMethod: "cash", accountId: acct.cash });
    expect([await holding("bank"), await holding("cash"), await holding("mobile")]).toEqual([tk(10000), tk(2500), tk(350)]);
    expect(await spendable()).toBe(tk(12850));

    // Money added and kept in Mobile Banking goes to Mobile Banking only.
    await createTransaction(userId, { type: "income", title: "Freelance", amount: "5000", date: "2026-10-04", incomeKind: "other", paymentMethod: "mobile", accountId: acct.mobile });
    expect([await holding("bank"), await holding("cash"), await holding("mobile")]).toEqual([tk(10000), tk(2500), tk(5350)]);
    const h = await getHoldings(userId);
    expect(h.total).toBe(await spendable()); // Bank + Cash + Mobile = Remaining balance
    expect(h.total).toBe(tk(17850));
    const [cycle] = await getSalaryCycles(userId);
    expect([cycle.otherIncome, cycle.totalSpent, cycle.remainingAtEnd]).toEqual([tk(5000), tk(500), tk(17850)]);
    await expectIntegrity();
  });
});

describe("personal date filter statement", () => {
  it("opening + received − spent = closing = the real balance at the end of the period", async () => {
    const { listTransactions } = await import("@/lib/services/transactions");
    const { parseTxnFilters } = await import("@/lib/filters");
    await salary(10000, "2026-10-01");
    await expense("Groceries", 500, "2026-10-05");
    await createTransaction(userId, { type: "transfer", title: "ATM", amount: "2000", date: "2026-10-06", accountId: acct.bank, toAccountId: acct.cash });
    await saveLoan(userId, { direction: "lent", person: "Rahim", amount: "1000", date: "2026-10-06", accountId: acct.cash });
    await createTransaction(userId, { type: "income", title: "Freelance", amount: "700", date: "2026-10-08", incomeKind: "other", accountId: acct.mobile });
    await expense("Fuel", 300, "2026-10-12");

    const statement = async (sp: Record<string, string>) => {
      const f = parseTxnFilters(sp);
      const list = await listTransactions(userId, f);
      const opening = f.from ? (await getBalanceSummary(userId, new Date(Date.parse(`${f.from}T00:00:00Z`) - 864e5).toISOString().slice(0, 10))).spendable : 0;
      const closing = opening + list.totals.moneyIn - list.totals.moneyOut;
      return { opening: opening / 100, in: list.totals.moneyIn / 100, out: list.totals.moneyOut / 100, closing: closing / 100, real: (await getBalanceSummary(userId, f.to!)).spendable / 100 };
    };
    // Range 5–10 Oct: transfer not counted; lending counted as money out (not an expense).
    expect(await statement({ period: "range", from: "2026-10-05", to: "2026-10-10" })).toEqual({ opening: 10000, in: 700, out: 1500, closing: 9200, real: 9200 });
    expect(await statement({ period: "date", date: "2026-10-12" })).toEqual({ opening: 9200, in: 0, out: 300, closing: 8900, real: 8900 });
    expect(await statement({ period: "week", date: "2026-10-08" })).toEqual({ opening: 10000, in: 700, out: 1500, closing: 9200, real: 9200 }); // Sat 3 – Fri 9
    expect(await statement({ period: "month", month: "2026-10" })).toEqual({ opening: 0, in: 10700, out: 1800, closing: 8900, real: 8900 });
  });
});
