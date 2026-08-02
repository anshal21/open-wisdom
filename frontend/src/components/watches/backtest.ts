import type { WatchCondition } from "@/lib/api/types";

/**
 * The live back-test behind the sensitivity slider. screens.md §9.3.
 *
 * "A threshold set without knowing its historical fire rate is how alert
 * fatigue starts" — so this runs for real, against the watch's own history,
 * and recomputes on every slider move.
 *
 * Incomplete periods never count as a firing. That is the same judgment the
 * pre-alert checks apply live, applied to the past.
 */

export interface HistoryPoint {
  t: string;
  value: number;
  incomplete?: boolean;
}

export interface BacktestResult {
  /** Indices of the points that would have fired. */
  fires: number[];
  /** Periods actually evaluated (a trailing window is needed to judge them). */
  evaluated: number;
  /** Total points supplied. */
  periods: number;
  /** Points skipped because the period was still in progress. */
  heldIncomplete: number;
}

const WINDOW = 30;
const MIN_WINDOW = 10;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function backtest(
  history: HistoryPoint[],
  condition: WatchCondition,
): BacktestResult {
  const fires: number[] = [];
  let evaluated = 0;
  let heldIncomplete = 0;

  for (let i = 0; i < history.length; i++) {
    const point = history[i];
    if (point.incomplete) {
      heldIncomplete += 1;
      continue;
    }

    if (condition.kind === "threshold") {
      evaluated += 1;
      const below = point.value < condition.value;
      const above = point.value > condition.value;
      if (condition.direction === "above" ? above : condition.direction === "below" ? below : below || above)
        fires.push(i);
      continue;
    }

    if (condition.kind === "change_pct") {
      const prev = history[i - 1];
      if (!prev || prev.value === 0) continue;
      evaluated += 1;
      const change = ((point.value - prev.value) / Math.abs(prev.value)) * 100;
      const hit =
        condition.direction === "above"
          ? change > condition.value
          : condition.direction === "below"
            ? change < -condition.value
            : Math.abs(change) > condition.value;
      if (hit) fires.push(i);
      continue;
    }

    // outside_normal_range — the band is the trailing distribution, widened by
    // the sensitivity multiple.
    const window = history
      .slice(Math.max(0, i - WINDOW), i)
      .filter((p) => !p.incomplete)
      .map((p) => p.value);
    if (window.length < MIN_WINDOW) continue;
    evaluated += 1;
    const m = mean(window);
    const sd = stdev(window);
    const lo = m - condition.value * sd;
    const hi = m + condition.value * sd;
    const hit =
      condition.direction === "above"
        ? point.value > hi
        : condition.direction === "below"
          ? point.value < lo
          : point.value < lo || point.value > hi;
    if (hit) fires.push(i);
  }

  return { fires, evaluated, periods: history.length, heldIncomplete };
}
