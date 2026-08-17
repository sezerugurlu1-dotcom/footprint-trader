// Compact stats strip rendered at the bottom of the chart panel.
// Shows four values for the most recent loaded candle and a window
// summary:
//
//   Vol       — kline volume of the most recent candle
//   Δ         — taker buy vol − taker sell vol of the most recent candle
//   Δ Max     — max delta across the last N candles
//   Δ Min     — min delta across the last N candles
//
// Delta is computed directly from the kline's built-in taker-buy
// split (Candle.takerBuyVolume) so the bar covers all loaded history
// instantly, without any aggTrades backfill.

import { formatVolume } from '../utils/format';

interface Props {
  volume: number | null;
  currentDelta: number;
  maxDelta: number;
  minDelta: number;
  /** How many candles the max/min window covers — shown as a hint. */
  windowSize?: number;
}

function signed(v: number): string {
  return v >= 0 ? `+${formatVolume(v)}` : formatVolume(v);
}

function deltaColor(v: number): string {
  return v > 0 ? 'text-tv-green' : v < 0 ? 'text-tv-red' : 'text-tv-text';
}

export function DeltaStatsBar({
  volume,
  currentDelta,
  maxDelta,
  minDelta,
  windowSize = 20,
}: Props) {
  return (
    <div
      className="delta-stats-bar"
      role="status"
      aria-label="Per-candle taker buy/sell delta over the last candles"
    >
      <Stat
        label="Vol"
        value={volume != null ? formatVolume(volume) : '—'}
        tone="text-tv-text"
        title="Volume of the most recent candle (kline)"
      />
      <Divider />
      <Stat
        label="Δ"
        value={signed(currentDelta)}
        tone={deltaColor(currentDelta)}
        title="Delta of the most recent candle (taker buy − taker sell)"
      />
      <Divider />
      <Stat
        label="Δ Max"
        value={signed(maxDelta)}
        tone={deltaColor(maxDelta)}
        title={`Max delta across the last ${windowSize} candles`}
      />
      <Divider />
      <Stat
        label="Δ Min"
        value={signed(minDelta)}
        tone={deltaColor(minDelta)}
        title={`Min delta across the last ${windowSize} candles`}
      />
      <div className="delta-stats-bar__hint">
        last {windowSize} candles
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone: string;
  title?: string;
}) {
  return (
    <div className="delta-stats-bar__stat" title={title}>
      <span className="delta-stats-bar__label">{label}</span>
      <span className={`delta-stats-bar__value font-mono ${tone}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <span className="delta-stats-bar__divider" aria-hidden="true" />;
}
