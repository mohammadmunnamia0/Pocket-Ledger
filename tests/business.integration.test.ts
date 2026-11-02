/**
 * Phase 2: the reusable Business Accounting System, verified with the Alwin BD example
 * from the specification (expected balance ৳24,290), against a real MongoDB (throwaway DB).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "@/lib/db/connect";
import { Business, BusinessTxn } from "@/lib/db/models";
import { createUser } from "@/lib/services/setup";
import { createTransaction } from "@/lib/services/transactions";
import { getBalanceSummary } from "@/lib/services/finance";
import {
  deleteBusinessTxn,
  getBusinessLedger,
  listBusinessCards,
  saveBusinessTxn,
  saveInterBusiness,
  setupBusiness,
} from "@/lib/services/business";
import { parsePeriod, weekStart } from "@/lib/business/period";

const tk = (n: number) => n * 100;
const ALL = parsePeriod({});
let userId = "";
let counter = 0;
let returnHexId = "";

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
  userId = await createUser({ name: "Tester", email: `b${Date.now()}${counter++}@example.test`, password: "password123" });
  await setupBusiness(userId, "alwin-bd", { name: "Alwin BD", type: "Online Clothing Brand", openingBalance: "0", openingDate: "2026-10-05" });
  // ReturnHex is turned on in Phase 3; here it only exists as the other side of the linked investment.
  const rh = await Business.create({ userId: new mongoose.Types.ObjectId(userId), key: "returnhex", name: "ReturnHex", type: "IT Firm", openingBalance: tk(24778), openingDate: "2026-10-08" });
  returnHexId = rh._id.toString();
});

const add = (kind: string, title: string, amount: number, date: string, key = "alwin-bd") =>
  saveBusinessTxn(userId, key, { kind: kind as never, title, amount: String(amount), date });

async function enterAlwinExample() {
  await add("owner_investment", "Rakib Investment", 6000, "2026-10-05");
  await add("owner_investment", "Munna Investment", 6000, "2026-10-05");
  await add("owner_investment", "Raiyan Investment", 6000, "2026-10-05");
  await add("domain_hosting", "Domain Cost", 1510, "2026-10-07");
  await add("owner_investment", "Tonmoy Investment", 6000, "2026-10-09");
  // Recorded from Alwin BD as money received from ReturnHex — both sides are created.
  const ref = await saveInterBusiness(userId, "alwin-bd", { interKind: "investment", direction: "in", otherBusinessId: returnHexId, title: "ReturnHex Investment", amount: "16000", date: "2026-10-09" });
  await add("product_purchase", "Thrift Winter Product Purchase", 14200, "2026-10-20");
  return ref;
}
const ledger = async (key = "alwin-bd", sp: Record<string, string> = {}) => (await getBusinessLedger(userId, key, parsePeriod(sp)))!;

describe("Alwin BD example", () => {
  it("reproduces the expected history and ends at ৳24,290", async () => {
    await enterAlwinExample();
    const l = await ledger();
    expect(l.rows.map((r) => [r.date, r.title, r.balance / 100])).toEqual([
      ["2026-10-05", "Rakib Investment", 6000],
      ["2026-10-05", "Munna Investment", 12000],
      ["2026-10-05", "Raiyan Investment", 18000],
      ["2026-10-07", "Domain Cost", 16490],
      ["2026-10-09", "Tonmoy Investment", 22490],
      ["2026-10-09", "ReturnHex Investment", 38490],
      ["2026-10-20", "Thrift Winter Product Purchase", 24290],
    ]);
    expect(l.overall).toMatchObject({
      openingBalance: 0,
      moneyIn: tk(40000),
      moneyOut: tk(15710),
      investmentsReceived: tk(40000), // capital: 4 owners + ReturnHex — not revenue
      income: 0,
      expenses: tk(15710),
      closingBalance: tk(24290),
    });
    const rh = l.rows.find((r) => r.title === "ReturnHex Investment")!;
    expect([rh.kind, rh.other?.name, rh.interKind]).toEqual(["investment_from_business", "ReturnHex", "investment"]);

    // The other side exists once in ReturnHex, linked by the same reference.
    const r = await ledger("returnhex");
    expect(r.rows.map((x) => [x.title, x.kind, x.amount])).toEqual([["ReturnHex Investment", "investment_in_business", tk(16000)]]);
    expect(r.rows[0].linkRef).toBe(rh.linkRef);
    expect(r.overall.closingBalance).toBe(tk(24778 - 16000));

    const cards = await listBusinessCards(userId);
    expect(cards.find((c) => c.key === "alwin-bd")!.balance).toBe(tk(24290));
  });

  it("editing and deleting recalculate the running balance; linked changes update both businesses", async () => {
    const ref = await enterAlwinExample();
    const domain = (await ledger()).rows.find((r) => r.title === "Domain Cost")!;
    await saveBusinessTxn(userId, "alwin-bd", { kind: "domain_hosting", title: "Domain Cost", amount: "1600", date: "2026-10-07" }, domain.id);
    let l = await ledger();
    expect(l.rows.map((r) => r.balance / 100)).toEqual([6000, 12000, 18000, 16400, 22400, 38400, 24200]);

    await deleteBusinessTxn(userId, "alwin-bd", domain.id);
    l = await ledger();
    expect(l.overall.closingBalance).toBe(tk(25800));

    // Edit the linked investment from Alwin BD → ReturnHex changes too.
    await saveInterBusiness(userId, "alwin-bd", { interKind: "investment", direction: "in", otherBusinessId: returnHexId, title: "ReturnHex Investment", amount: "15000", date: "2026-10-09" }, ref);
    expect((await ledger()).overall.closingBalance).toBe(tk(24800));
    expect((await ledger("returnhex")).overall.closingBalance).toBe(tk(24778 - 15000));
    expect(await BusinessTxn.countDocuments({ linkRef: ref })).toBe(2);

    // It can't be edited as an ordinary transaction (that would split the pair).
    const linked = (await ledger()).rows.find((r) => r.linkRef)!;
    await expect(saveBusinessTxn(userId, "alwin-bd", { kind: "other_in", title: "x", amount: "1", date: "2026-10-09" }, linked.id)).rejects.toThrow(/inter-business/);

    // Deleting it from ReturnHex removes both sides.
    const rhSide = (await ledger("returnhex")).rows[0];
    await deleteBusinessTxn(userId, "returnhex", rhSide.id);
    expect(await BusinessTxn.countDocuments({ linkRef: ref })).toBe(0);
    expect((await ledger()).overall.closingBalance).toBe(tk(9800));
    expect((await ledger("returnhex")).overall.closingBalance).toBe(tk(24778));
  });

  it("date filters: opening + money in − money out = closing for a date, week, month and range", async () => {
    await enterAlwinExample();
    const pick = (l: Awaited<ReturnType<typeof ledger>>) => [l.period.openingBalance, l.period.moneyIn, l.period.moneyOut, l.period.closingBalance].map((v) => v / 100);

    expect(pick(await ledger("alwin-bd", { period: "date", date: "2026-10-09" }))).toEqual([16490, 22000, 0, 38490]);
    expect(weekStart("2026-10-09")).toBe("2026-10-03"); // Saturday
    expect(pick(await ledger("alwin-bd", { period: "week", date: "2026-10-09" }))).toEqual([0, 40000, 1510, 38490]);
    expect(pick(await ledger("alwin-bd", { period: "month", month: "2026-10" }))).toEqual([0, 40000, 15710, 24290]);
    const range = await ledger("alwin-bd", { period: "range", from: "2026-10-07", to: "2026-10-20" });
    expect(pick(range)).toEqual([18000, 22000, 15710, 24290]);
    expect(range.rows.map((r) => r.balance / 100)).toEqual([16490, 22490, 38490, 24290]); // true balances, not period sums
    expect(pick(await ledger("alwin-bd", { period: "month", month: "2026-11" }))).toEqual([24290, 0, 0, 24290]);
  });
});

describe("separation and safeguards", () => {
  it("keeps every business's records and balance separate, and never touches personal finance", async () => {
    await createTransaction(userId, { type: "income", title: "Salary", amount: "20000", date: "2026-10-01", incomeKind: "salary" });
    const personalBefore = (await getBalanceSummary(userId, "2026-12-31")).spendable;
    await enterAlwinExample();
    const rhBefore = (await ledger("returnhex")).overall.closingBalance;

    // An ordinary Alwin BD transaction doesn't move ReturnHex.
    const id = await add("marketing", "Facebook ads", 500, "2026-10-21");
    expect((await ledger("returnhex")).overall.closingBalance).toBe(rhBefore);
    expect((await ledger()).overall.closingBalance).toBe(tk(23790));

    // A transaction can only be changed through its own business.
    await expect(saveBusinessTxn(userId, "returnhex", { kind: "marketing", title: "x", amount: "1", date: "2026-10-21" }, id)).rejects.toThrow(/not found/i);
    await expect(deleteBusinessTxn(userId, "returnhex", id)).rejects.toThrow(/not found/i);
    expect((await ledger()).overall.closingBalance).toBe(tk(23790));

    // Another user's business is invisible.
    const stranger = await createUser({ name: "Other", email: `o${Date.now()}@example.test`, password: "password123" });
    await expect(deleteBusinessTxn(stranger, "alwin-bd", id)).rejects.toThrow(/not found/i);

    expect((await getBalanceSummary(userId, "2026-12-31")).spendable).toBe(personalBefore);
  });

  it("no duplicate inter-business pairs on retry; dates before the opening balance are refused", async () => {
    const raw = { interKind: "transfer" as const, direction: "out" as const, otherBusinessId: returnHexId, amount: "1000", date: "2026-10-10", ref: "retry-ref-0001" };
    await add("owner_investment", "Seed", 5000, "2026-10-05");
    await saveInterBusiness(userId, "alwin-bd", raw);
    await saveInterBusiness(userId, "alwin-bd", raw);
    expect(await BusinessTxn.countDocuments({ linkRef: "retry-ref-0001" })).toBe(2);
    expect((await ledger()).overall.closingBalance).toBe(tk(4000));

    await expect(add("expense", "Too early", 10, "2026-10-01")).rejects.toThrow(/records start on/);
    // ReturnHex's records start 8 Oct, so a linked entry on 6 Oct is refused for both.
    await expect(saveInterBusiness(userId, "alwin-bd", { ...raw, ref: "retry-ref-0002", date: "2026-10-06" })).rejects.toThrow(/ReturnHex's records start/);
    expect(await BusinessTxn.countDocuments({ linkRef: "retry-ref-0002" })).toBe(0);

    // Only the known businesses can be set up.
    await expect(setupBusiness(userId, "not-a-business", { name: "X", openingBalance: "0", openingDate: "2026-10-01" })).rejects.toThrow(/isn't available/);
  });

  it("renaming a business keeps its history (records point at its id, not its name)", async () => {
    await enterAlwinExample();
    await setupBusiness(userId, "alwin-bd", { name: "Alwin BD Fashion", type: "Online Clothing Brand", openingBalance: "0", openingDate: "2026-10-05" });
    const l = await ledger();
    expect([l.business.name, l.overall.closingBalance, l.rows.length]).toEqual(["Alwin BD Fashion", tk(24290), 7]);
    expect((await ledger("returnhex")).rows[0].other?.name).toBe("Alwin BD Fashion");
    await expect(setupBusiness(userId, "alwin-bd", { name: "Alwin BD", openingBalance: "0", openingDate: "2026-10-06" })).rejects.toThrow(/on or before the first transaction/);
  });
});

describe("ReturnHex (Phase 3) — the same system, its own records", () => {
  it("opening ৳24,778 → Tonmoy +4,000 → Alwin BD −16,000 (linked) → Suraiya −4,010 = ৳8,768", async () => {
    // Set up through the app's own path (beforeEach only created a stand-in record).
    await Business.deleteMany({ userId: new mongoose.Types.ObjectId(userId), key: "returnhex" });
    await setupBusiness(userId, "returnhex", { name: "ReturnHex", type: "IT Firm", openingBalance: "24778", openingDate: "2026-10-08" });
    const alwinBefore = (await ledger()).overall.closingBalance;

    await add("owner_investment", "Tonmoy Investment", 4000, "2026-10-09", "returnhex");
    const alwinId = (await listBusinessCards(userId)).find((c) => c.key === "alwin-bd")!.business!.id;
    const ref = await saveInterBusiness(userId, "returnhex", { interKind: "investment", direction: "out", otherBusinessId: alwinId, title: "Investment in Alwin BD", amount: "16000", date: "2026-10-09" });
    await add("other_out", "Suraiya Payment", 4010, "2026-10-09", "returnhex");

    const r = await ledger("returnhex");
    expect(r.overall.openingBalance).toBe(tk(24778));
    expect(r.rows.map((x) => [x.date, x.title, x.balance / 100])).toEqual([
      ["2026-10-09", "Tonmoy Investment", 28778],
      ["2026-10-09", "Investment in Alwin BD", 12778],
      ["2026-10-09", "Suraiya Payment", 8768],
    ]);
    expect(r.overall).toMatchObject({ moneyIn: tk(4000), moneyOut: tk(20010), investmentsReceived: tk(4000), investedInOthers: tk(16000), closingBalance: tk(8768) });

    // The opening balance is not income or investment.
    expect(r.overall.income).toBe(0);

    // The ৳16,000 is one linked transaction: −16,000 here, +16,000 in Alwin BD, same reference.
    const alwin = await ledger();
    const inSide = alwin.rows.find((x) => x.linkRef === ref)!;
    expect([inSide.kind, inSide.amount, inSide.other?.name]).toEqual(["investment_from_business", tk(16000), "ReturnHex"]);
    expect(alwin.overall.closingBalance).toBe(alwinBefore + tk(16000));
    expect(await BusinessTxn.countDocuments({ linkRef: ref })).toBe(2);

    // ReturnHex's own transactions never touch Alwin BD.
    await add("expense", "Server rent", 500, "2026-10-10", "returnhex");
    expect((await ledger()).overall.closingBalance).toBe(alwinBefore + tk(16000));
    expect((await ledger("returnhex")).overall.closingBalance).toBe(tk(8268));

    // Date filter on ReturnHex: 9 Oct opens at the opening balance and closes at ৳8,768.
    const day = await ledger("returnhex", { period: "date", date: "2026-10-09" });
    expect([day.period.openingBalance, day.period.moneyIn, day.period.moneyOut, day.period.closingBalance].map((v) => v / 100)).toEqual([24778, 4000, 20010, 8768]);
  });
});

describe("Naire (Phase 4) — three businesses, one system, separate records", () => {
  it("needs its opening balance entered, keeps its own records, and links only explicitly", async () => {
    // Nothing exists for Naire until it is set up — no invented opening balance or history.
    expect(await getBusinessLedger(userId, "naire", ALL)).toBeNull();
    expect((await listBusinessCards(userId)).find((c) => c.key === "naire")).toMatchObject({ available: true, business: null, balance: null });
    // A blank opening balance is refused, never assumed to be 0.
    await expect(setupBusiness(userId, "naire", { name: "Naire", type: "Women's Lifestyle Brand", openingBalance: "", openingDate: "2026-10-01" })).rejects.toThrow(/opening balance/);
    expect(await getBusinessLedger(userId, "naire", ALL)).toBeNull();
    await setupBusiness(userId, "naire", { name: "Naire", type: "Women's Lifestyle Brand", openingBalance: "3000", openingDate: "2026-10-01" });

    await enterAlwinExample();
    const before = { alwin: (await ledger()).overall.closingBalance, rh: (await ledger("returnhex")).overall.closingBalance };

    // Naire's own categories: inventory, marketing, hosting, supplier, income.
    await add("owner_investment", "Owner capital", 10000, "2026-10-02", "naire");
    await add("inventory", "Fabric stock", 4500, "2026-10-03", "naire");
    await add("marketing", "Instagram ads", 800, "2026-10-04", "naire");
    await add("domain_hosting", "Shop domain", 1200, "2026-10-04", "naire");
    await add("supplier_payment", "Tailor", 1500, "2026-10-06", "naire");
    await add("income", "First orders", 3600, "2026-10-08", "naire");

    const n = await ledger("naire");
    expect(n.rows.map((r) => r.balance / 100)).toEqual([13000, 8500, 7700, 6500, 5000, 8600]);
    expect(n.overall).toMatchObject({
      openingBalance: tk(3000),
      investmentsReceived: tk(10000),
      income: tk(3600), // revenue kept apart from capital
      expenses: tk(8000),
      closingBalance: tk(8600),
    });

    // None of that touched Alwin BD or ReturnHex.
    expect((await ledger()).overall.closingBalance).toBe(before.alwin);
    expect((await ledger("returnhex")).overall.closingBalance).toBe(before.rh);

    // An explicit transfer ReturnHex → Naire moves exactly those two; Alwin BD is unchanged.
    const naireId = (await listBusinessCards(userId)).find((c) => c.key === "naire")!.business!.id;
    const ref = await saveInterBusiness(userId, "returnhex", { interKind: "transfer", direction: "out", otherBusinessId: naireId, amount: "2000", date: "2026-10-10" });
    expect((await ledger("naire")).overall.closingBalance).toBe(tk(10600));
    expect((await ledger("returnhex")).overall.closingBalance).toBe(before.rh - tk(2000));
    expect((await ledger()).overall.closingBalance).toBe(before.alwin);
    const sides = await BusinessTxn.find({ linkRef: ref }).lean();
    expect(sides.map((x) => x.kind).sort()).toEqual(["transfer_from_business", "transfer_to_business"]);

    // A Naire transaction can't be reached through another business.
    const naireRow = (await ledger("naire")).rows.find((r) => r.title === "Fabric stock")!;
    await expect(deleteBusinessTxn(userId, "alwin-bd", naireRow.id)).rejects.toThrow(/not found/i);
    await expect(saveBusinessTxn(userId, "returnhex", { kind: "inventory", title: "x", amount: "1", date: "2026-10-03" }, naireRow.id)).rejects.toThrow(/not found/i);

    // Deleting the transfer from Naire removes both sides; totals return exactly.
    const naireSide = (await ledger("naire")).rows.find((r) => r.linkRef === ref)!;
    await deleteBusinessTxn(userId, "naire", naireSide.id);
    expect([(await ledger()).overall.closingBalance, (await ledger("returnhex")).overall.closingBalance, (await ledger("naire")).overall.closingBalance]).toEqual([
      before.alwin,
      before.rh,
      tk(8600),
    ]);

    // Landing cards: each from its own records.
    const cards = await listBusinessCards(userId);
    expect(cards.map((c) => [c.key, c.balance])).toEqual([
      ["alwin-bd", before.alwin],
      ["returnhex", before.rh],
      ["naire", tk(8600)],
    ]);
  });
});
