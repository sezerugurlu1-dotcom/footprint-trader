// Per-candle "Footprint Summary" table — rendered as a horizontal grid
// below the chart, with one cell per *visible* candle.
//
// Layout: each cell is absolutely positioned at the same X coordinate
// as its candle in the chart (via chart.timeScale().timeToCoordinate).
// This means zooming or panning the chart re-lays out the table so
// columns stay aligned with the candles in real time.
//
// Four rows:
//   Volume   — kline total volume (all candles; always present)
//   Δ        — kline taker buy − taker sell (all candles; always present)
//   Δ Max    — most positive per-level delta in that candle
//              (footprint data; only candles the backfill reached)
//   Δ Min    — most negative per-level delta in that candle
//              (footprint data; only candles the backfill reached)
//
// Color rules (per the user's spec):
//   - Δ cell is green if value > 0, red if < 0
//   - Δ Max / Δ Min cells: positive = green tint, negative = red tint,
//     missing data = dimmed "—"
//   - Volume row is muted by default

import { useEffect, useMemo, useState } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import type { Candle } from '../types';

interface Props {
  candles: Candle[];
  /** Map of candle time → { max, min } from footprint per-level data.
   *  Candles missing from this map render "—" in the Max/Min rows. */
  maxMinByTime: Record<number, { max: number; min: number }>;
  /** Live chart instance — drives the X-coordinate alignment and
   *  re-layouts on pan / zoom.  When null (chart not yet created)
   *  the table renders empty. */
  chart: IChartApi | null;
  /** Height of the table container in pixels.  The default 56px
   *  (4 rows × 14px) matches the CSS class; the parent passes a
   *  larger value when the user has dragged the resize handle. */
  height?: number;
}

interface PositionedCell {
  candle: Candle;
  x: number;
  width: number;
}

const POS_TONE = 'delta-table__cell--pos';
const NEG_TONE = 'delta-table__cell--neg';
const ZERO_TONE = 'delta-table__cell--zero';

function tone(v: number | null | undefined): string {
  if (v == null) return ZERO_TONE;
  if (v > 0) return POS_TONE;
  if (v < 0) return NEG_TONE;
  return ZERO_TONE;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : '';
  if (abs >= 1e6) return `${sign}${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(v / 1e3).toFixed(2)}K`;
  if (abs >= 1) return `${sign}${v.toFixed(0)}`;
  if (abs > 0) return `${sign}${v.toFixed(2)}`;
  return '0';
}

function candleDelta(c: Candle): number {
  return 2 * c.takerBuyVolume - c.volume;
}

/** Compute one row of cells.  `keyPrefix` distinguishes the four rows
 *  in the rendered DOM, and `getValue` pulls the per-candle number
 *  (or null when missing) for that row. */
function renderRow(
  cells: PositionedCell[],
  keyPrefix: string,
  getValue: (c: Candle) => number | null
) {
  return cells.map(({ candle, x, width }) => {
    const v = getValue(candle);
    const valueText = fmt(v);
    return (
      <div
        key={`${keyPrefix}-${candle.time}`}
        className={`delta-table__cell ${tone(v)}`}
        role="cell"
        title={valueText}
        style={{
          transform: `translateX(${x}px)`,
          width: `${width}px`,
        }}
      >
        {valueText}
      </div>
    );
  });
}

export function DeltaTable({ candles, maxMinByTime, chart, height }: Props) {
  // Bump on any chart-time-scale change (pan, zoom, new data) so the
  // `useMemo` below re-runs and the cells re-position.  We don't store
  // the new range itself — we just call `getVisibleLogicalRange()`
  // inside the memo for the freshest values.
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => {
    if (!chart) return;

    // The handler takes the new LogicalRange but we don't need it —
    // the memo below re-reads `getVisibleLogicalRange()` directly so
    // positions are always sourced from the freshest state.
    const onChange = () => {
      setLayoutTick((t) => t + 1);
    };

    // Fire once on mount so the very first paint has correct positions
    // even before the user interacts.
    onChange();

    // `subscribeVisibleLogicalRangeChange` exists at runtime; the
    // bundled type definitions in this project omit it, so we cast
    // through `unknown` to keep the call site clean.
    const ts = chart.timeScale() as unknown as {
      subscribeVisibleLogicalRangeChange: (h: () => void) => unknown;
      unsubscribeVisibleLogicalRangeChange: (s: unknown) => void;
    };
    const sub = ts.subscribeVisibleLogicalRangeChange(onChange);
    return () => {
      try {
        ts.unsubscribeVisibleLogicalRangeChange(sub);
      } catch {
        /* chart may have been disposed */
      }
    };
  }, [chart]);

  // Compute the position + width of every candle that is currently
  // visible in the chart.  We clip to the loaded range so we never
  // ask for a candle outside `candles`.
  const positioned = useMemo<PositionedCell[]>(() => {
    if (!chart || candles.length === 0) return [];

    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) return [];

    const fromIdx = Math.max(0, Math.floor(range.from));
    const toIdx = Math.min(candles.length - 1, Math.ceil(range.to));
    if (toIdx < fromIdx) return [];

    const result: PositionedCell[] = [];
    for (let i = fromIdx; i <= toIdx; i++) {
      const c = candles[i];
      const x = chart.timeScale().timeToCoordinate(c.time as Time);
      if (x == null) continue;

      // Cell width = distance to the next candle's left edge.
      // Falls back to a small minimum so single-candle views still
      // show something readable.
      const next = candles[i + 1];
      const nextX = next
        ? chart.timeScale().timeToCoordinate(next.time as Time)
        : null;
      const width =
        nextX != null
          ? Math.max(2, nextX - x)
          : Math.max(2, x * 0.02 + 4);

      result.push({ candle: c, x, width });
    }
    return result;
  }, [chart, candles, layoutTick]);

  if (!chart) {
    return (
      <div
        className="delta-table delta-table--empty"
        style={height ? { height, minHeight: height } : undefined}
      >
        <span>Loading chart…</span>
      </div>
    );
  }

  if (candles.length === 0) {
    return (
      <div
        className="delta-table delta-table--empty"
        style={height ? { height, minHeight: height } : undefined}
      >
        <span>No candle data</span>
      </div>
    );
  }

  return (
    <div
      className="delta-table delta-table--aligned"
      role="table"
      aria-label="Per-candle order-flow summary"
      style={height ? { height, minHeight: height } : undefined}
    >
      {/* Row labels: absolutely positioned over the leftmost part of
          the table so the cell-alignment-by-chart-X trick below is
          undisturbed.  Width covers roughly the chart's left padding
          (the leftmost candle is never inside this band). */}
      <div className="delta-table__labels" aria-hidden="true">
        <div className="delta-table__label delta-table__label--vol">Vol</div>
        <div className="delta-table__label delta-table__label--delta">Δ</div>
        <div className="delta-table__label delta-table__label--max">Δ Max</div>
        <div className="delta-table__label delta-table__label--min">Δ Min</div>
      </div>

      <div className="delta-table__row" role="row">
        {renderRow(positioned, 'v', (c) => c.volume)}
      </div>
      <div className="delta-table__row delta-table__row--delta" role="row">
        {renderRow(positioned, 'd', (c) => candleDelta(c))}
      </div>
      <div className="delta-table__row delta-table__row--max" role="row">
        {renderRow(
          positioned,
          'mx',
          (c) => maxMinByTime[c.time]?.max ?? null
        )}
      </div>
      <div className="delta-table__row delta-table__row--min" role="row">
        {renderRow(
          positioned,
          'mn',
          (c) => maxMinByTime[c.time]?.min ?? null
        )}
      </div>
    </div>
  );
}
