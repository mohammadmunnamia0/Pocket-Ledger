/**
 * Pure FIFO funding allocator — the heart of salary-wise tracking.
 *
 * Sources are money arriving (salaries, other income, savings withdrawals).
 * Consumers are money leaving the spendable pool (paid expenses, savings deposits).
 *
 * Rules:
 *  - Ledger order is (date, seq, id). Same-day sources can fund same-day consumers.
 *  - A consumer can only be funded by sources dated on or before it (money not yet
 *    received can never fund an earlier expense).
 *  - The consumer's preferred source (manual override) is drawn first, then the
 *    oldest source with money left.
 *  - A source is never allocated beyond its amount; shortfalls are reported, never hidden.
 *
 * Because availability only grows over time, greedy chronological allocation succeeds
 * exactly when every prefix of the ledger has enough money — so any reported shortfall
 * is a genuine one.
 */

export interface LedgerItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Tie-breaker within a day (creation time in ms). */
  seq: number;
  /** Poisha, > 0 */
  amount: number;
}

export type FundingSource = LedgerItem;

export interface FundingConsumer extends LedgerItem {
  preferredSourceId?: string | null;
}

export interface Allocation {
  consumerId: string;
  sourceId: string;
  amount: number;
}

export interface Shortfall {
  consumerId: string;
  date: string;
  required: number;
  funded: number;
}

export interface FifoResult {
  allocations: Allocation[];
  shortfalls: Shortfall[];
  /** Remaining poisha per source after allocation. */
  remaining: Map<string, number>;
}

export function compareLedgerOrder(a: LedgerItem, b: LedgerItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * @param alreadyUsed poisha already consumed from each source by allocations that are
 *                    not being recomputed (consumers dated before the recompute window).
 */
export function allocateFifo(
  sources: FundingSource[],
  consumers: FundingConsumer[],
  alreadyUsed: Map<string, number> = new Map(),
): FifoResult {
  const ordered = [...sources].sort(compareLedgerOrder);
  const remaining = new Map<string, number>();
  const position = new Map<string, number>();

  ordered.forEach((s, i) => {
    const left = s.amount - (alreadyUsed.get(s.id) ?? 0);
    if (left < 0) {
      throw new Error(`Funding source ${s.id} is over-allocated by ${-left} poisha`);
    }
    remaining.set(s.id, left);
    position.set(s.id, i);
  });

  const allocations: Allocation[] = [];
  const shortfalls: Shortfall[] = [];
  let head = 0;

  for (const consumer of [...consumers].sort(compareLedgerOrder)) {
    let need = consumer.amount;
    const draw = (source: FundingSource) => {
      const left = remaining.get(source.id)!;
      if (left <= 0 || need <= 0) return;
      const take = Math.min(left, need);
      remaining.set(source.id, left - take);
      need -= take;
      allocations.push({ consumerId: consumer.id, sourceId: source.id, amount: take });
    };

    if (consumer.preferredSourceId) {
      const i = position.get(consumer.preferredSourceId);
      if (i !== undefined && ordered[i].date <= consumer.date) draw(ordered[i]);
    }

    while (head < ordered.length && remaining.get(ordered[head].id)! <= 0) head++;
    for (let i = head; i < ordered.length && need > 0; i++) {
      if (ordered[i].date > consumer.date) break;
      draw(ordered[i]);
    }

    if (need > 0) {
      shortfalls.push({
        consumerId: consumer.id,
        date: consumer.date,
        required: consumer.amount,
        funded: consumer.amount - need,
      });
    }
  }

  return { allocations, shortfalls, remaining };
}
