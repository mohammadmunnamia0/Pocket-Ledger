import { connectDB } from "../db/connect";
import { FundingAllocation, Person, PersonAllocation, Transaction, oid } from "../db/models";
import { addDays, monthOf, monthStart, todayISO } from "../dates";
import { computeDashboardFigures } from "../ledger/model";
import { getLookups } from "./lookups";
import { getMonthlySeries, getPeriodReport } from "./finance";
import { getUpcomingBills } from "./bills";
import { listGoals } from "./savings";
import { listLoans, summarizeLoans } from "./loans";
import { getHoldings } from "./holdings";
import { listTransactions, toTxnDTO } from "./transactions";

/**
 * Everything the dashboard shows, computed from database records in one pass.
 *
 * The salary-period figures, balances, savings and borrowed money come from
 * computeDashboardFigures (lib/ledger/model.ts) — the very same function the offline app
 * runs on its IndexedDB copy — fed here with the stored FIFO funding ledger.
 * (Smart alerts live in the notification bell — see alert-feed.ts.)
 */
export async function getDashboard(userId: string) {
  await connectDB();
  const uid = oid(userId);
  const today = todayISO();
  const month = monthOf(today);

  const lookups = await getLookups(userId);
  const [allTxns, allocations, persons, personAllocations, mtd, series, upcoming, recent, pendingDocs, goals, loans, holdings] = await Promise.all([
    Transaction.find({ userId: uid }).lean(),
    FundingAllocation.find({ userId: uid }, { consumerId: 1, sourceId: 1, amount: 1, consumerDate: 1 }).lean(),
    Person.find({ userId: uid }, { name: 1 }).lean(),
    PersonAllocation.find({ userId: uid }, { personId: 1, month: 1, amount: 1, note: 1 }).lean(),
    getPeriodReport(userId, monthStart(month), today, {}, lookups),
    getMonthlySeries(userId, month, 6),
    getUpcomingBills(userId, today),
    listTransactions(userId, { pageSize: 8 }, lookups),
    Transaction.find({ userId: uid, status: "pending" }).sort({ date: 1 }).limit(8).lean(),
    listGoals(userId, today),
    listLoans(userId, today),
    getHoldings(userId),
  ]);

  const figures = computeDashboardFigures({
    txns: allTxns.map((t) => toTxnDTO(t, lookups)),
    lookups,
    persons: persons.map((p) => ({ id: p._id.toString(), name: p.name })),
    personAllocations: personAllocations.map((a) => ({ personId: a.personId.toString(), month: a.month, amount: a.amount, note: a.note ?? null })),
    allocations: allocations.map((a) => ({
      consumerId: a.consumerId.toString(),
      sourceId: a.sourceId.toString(),
      amount: a.amount,
      consumerDate: a.consumerDate,
    })),
    today,
  });

  // Daily spending for every day of the month so far.
  const dailyMap = new Map(mtd.daily.map((d) => [d.date, d.total]));
  const daily: { date: string; total: number }[] = [];
  for (let d = monthStart(month); d <= today; d = addDays(d, 1)) {
    daily.push({ date: d, total: dailyMap.get(d) ?? 0 });
  }

  return {
    today,
    month,
    period: figures.period,
    metrics: figures.metrics,
    borrowed: figures.borrowed,
    salary: { breakdown: figures.salaryBreakdown },
    categories: mtd.categories,
    daily,
    series,
    recent: recent.rows,
    pending: pendingDocs.map((p) => toTxnDTO(p, lookups)),
    upcoming,
    goals: goals.filter((g) => g.status === "active"),
    lent: summarizeLoans(loans, "lent"),
    owed: summarizeLoans(loans, "borrowed"),
    holdings,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
