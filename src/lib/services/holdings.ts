/**
 * Where the balance is kept: Bank, Cash and Mobile Banking.
 *
 * Each figure is the real balance of the accounts of that kind, calculated from transactions
 * (income and expenses on the account, transfers, loans, investments). Changing the split
 * records ordinary transfers between the accounts, so the total never changes and nothing
 * is counted as income or expense. Nothing is invented: a split that doesn't add up to the
 * current total is refused with an explanation.
 */
import { connectDB } from "../db/connect";
import { Account, oid, HOLDING_KINDS, type HoldingKind } from "../db/models";
import { AppError } from "../errors";
import { withLedger } from "../ledger/engine";
import { formatTaka, toInputValue } from "../money";
import { HOLDING_LABELS } from "../labels";
import { holdingsInputSchema, type HoldingsInputRaw } from "../validation";
import { getAccountBalances } from "./finance";
import { createTransaction } from "./transactions";

export interface Holding {
  kind: HoldingKind;
  label: string;
  amount: number;
  note: string | null;
  /** The account money moves to/from when the split changes. */
  accountId: string | null;
  accountNames: string[];
}

export interface Holdings {
  items: Holding[];
  /** Balance held in accounts of other kinds (card, savings account, other). */
  other: number;
  /** Bank + Cash + Mobile Banking. */
  total: number;
}

const DEFAULT_NAMES: Record<HoldingKind, string> = { bank: "Bank Account", cash: "Cash", mobile: "Mobile Banking" };

export async function getHoldings(userId: string): Promise<Holdings> {
  await connectDB();
  const [accounts, balances] = await Promise.all([
    // Same order as the forms (lookups), so a box and the form's choice mean the same account.
    Account.find({ userId: oid(userId) }).sort({ isDefault: -1, name: 1 }).lean(),
    getAccountBalances(userId),
  ]);
  const bal = (id: string) => balances.get(id) ?? 0;
  const items = HOLDING_KINDS.map((kind): Holding => {
    const mine = accounts.filter((a) => a.kind === kind);
    const primary = mine.find((a) => !a.archived) ?? mine[0];
    return {
      kind,
      label: HOLDING_LABELS[kind],
      amount: mine.reduce((s, a) => s + bal(a._id.toString()), 0),
      note: primary?.note ?? null,
      accountId: primary?._id.toString() ?? null,
      accountNames: mine.map((a) => a.name),
    };
  });
  const other = accounts.filter((a) => !(HOLDING_KINDS as readonly string[]).includes(a.kind)).reduce((s, a) => s + bal(a._id.toString()), 0);
  return { items, other, total: items.reduce((s, h) => s + h.amount, 0) };
}

/**
 * Set a new Bank / Cash / Mobile Banking split. The amounts must add up to the current
 * total of the three; the differences are recorded as transfers dated `date`.
 */
export async function setHoldings(userId: string, raw: HoldingsInputRaw): Promise<{ transfers: number }> {
  const input = holdingsInputSchema.parse(raw);
  const kinds = input.holdings.map((h) => h.kind);
  if (new Set(kinds).size !== 3) throw new AppError("Enter Bank, Cash and Mobile Banking once each");
  const current = await getHoldings(userId);
  const target = new Map(input.holdings.map((h) => [h.kind, h]));
  const newTotal = input.holdings.reduce((s, h) => s + h.amount, 0);
  if (newTotal !== current.total) {
    const diff = newTotal - current.total;
    throw new AppError(
      `These add up to ${formatTaka(newTotal)}, but the money recorded in Bank, Cash and Mobile Banking is ${formatTaka(current.total)} ` +
        `(${diff > 0 ? `${formatTaka(diff)} more` : `${formatTaka(-diff)} less`}). Moving money between them can't change the total — ` +
        `record the missing income or expense first, then split the balance.`,
    );
  }

  const uid = oid(userId);
  let transfers = 0;
  await withLedger(userId, async (session) => {
    // Every kind needs an account to move money to or from.
    const accountFor = new Map<HoldingKind, string>();
    for (const h of current.items) {
      if (h.accountId) {
        accountFor.set(h.kind, h.accountId);
      } else {
        const [created] = await Account.create([{ userId: uid, name: DEFAULT_NAMES[h.kind], kind: h.kind }], { session });
        accountFor.set(h.kind, created._id.toString());
      }
      const note = target.get(h.kind)!.note ?? null;
      await Account.updateOne({ _id: oid(accountFor.get(h.kind)!) }, note ? { $set: { note } } : { $unset: { note: 1 } }, { session });
    }

    // Move the differences: from places that go down to places that go up.
    const delta = current.items.map((h) => ({ kind: h.kind, d: target.get(h.kind)!.amount - h.amount }));
    const from = delta.filter((x) => x.d < 0).map((x) => ({ ...x, d: -x.d }));
    const to = delta.filter((x) => x.d > 0);
    for (const t of to) {
      for (const f of from) {
        const move = Math.min(t.d, f.d);
        if (move <= 0) continue;
        await createTransaction(
          userId,
          {
            type: "transfer",
            title: `Moved to ${HOLDING_LABELS[t.kind]} (balance split)`,
            amount: toInputValue(move),
            date: input.date,
            accountId: accountFor.get(f.kind),
            toAccountId: accountFor.get(t.kind),
            paymentMethod: "other",
            notes: `From ${HOLDING_LABELS[f.kind]} to ${HOLDING_LABELS[t.kind]} — set from the Remaining balance card.`,
          },
          { session },
        );
        transfers++;
        t.d -= move;
        f.d -= move;
      }
    }
  });
  return { transfers };
}
