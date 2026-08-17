// ChartLegend — the classic TradingView-style OHLCV status line that
// follows the crosshair. Falls back to the last candle when the user
// isn't hovering. Positioned absolutely in the top-left of the chart.

import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import { formatVolume } from '../utils/format';
import type { Candle } from '../types';

interface Props {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  /** Loaded candles — used to look up the volume of the hovered
   *  candle directly (the chart no longer carries a separate volume
   *  histogram series). */
  candles: Candle[];
  /** Latest candle — used to drive the "not hovering" fallback so the
   *  legend updates on every live kline tick without polling. */
  latest: { time: number; open: number; high: number; low: number; close: number; volume: number } | null;
  precision: number;
}

export function ChartLegend({ chart, candleSeries, candles, latest, precision }: Props) {
  const [hovered, setHovered] = useState<Ohlcv | null>(null);

  // Subscribe to the crosshair. On each move, capture the candle under
  // the cursor (if any). When the cursor leaves the chart, hovered goes
  // back to null and the component falls back to the `latest` prop.
  useEffect(() => {
    if (!chart || !candleSeries) return;

    // Build a quick time→candle lookup so the per-hover volume read
    // is O(1).  Recomputed when the candle list changes.
    const byTime = new Map<number, Candle>();
    for (const c of candles) byTime.set(c.time, c);

    const onMove = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setHovered(null);
        return;
      }
      const candleData = param.seriesData.get(candleSeries) as
        | { time: Time; open: number; high: number; low: number; close: number }
        | undefined;
      if (!candleData) {
        setHovered(null);
        return;
      }
      const t = typeof candleData.time === 'number' ? candleData.time : 0;
      const matched = byTime.get(t);
      setHovered({
        time: t,
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        volume: matched?.volume ?? 0,
      });
    };

    chart.subscribeCrosshairMove(onMove);
    return () => {
      try { chart.unsubscribeCrosshairMove(onMove); } catch { /* */ }
    };
  }, [chart, candleSeries, candles]);

  const ohlcv = hovered ?? latest;
  if (!ohlcv) return null;

  const isUp = ohlcv.close >= ohlcv.open;
  const accent = isUp ? 'text-tv-green' : 'text-tv-red';
  const fmt = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });

  const time = new Date(ohlcv.time * 1000);
  const dateStr = time.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      className={`absolute top-2 left-2 z-10 px-2.5 py-1.5 rounded text-[11px] font-mono leading-tight
                  bg-tv-panel/80 backdrop-blur-sm border border-tv-border
                  ${hovered ? 'opacity-100' : 'opacity-90'}`}
      style={{ pointerEvents: 'none' }}
    >
      <div className="text-tv-textDim text-[10px] mb-0.5">{dateStr}</div>
      <div className="flex items-center gap-3">
        <span><span className="text-tv-textDim">O </span><span className={accent}>{fmt(ohlcv.open)}</span></span>
        <span><span className="text-tv-textDim">H </span><span className="text-tv-green">{fmt(ohlcv.high)}</span></span>
        <span><span className="text-tv-textDim">L </span><span className="text-tv-red">{fmt(ohlcv.low)}</span></span>
        <span><span className="text-tv-textDim">C </span><span className={accent}>{fmt(ohlcv.close)}</span></span>
        <span className="text-tv-textDim">·</span>
        <span><span className="text-tv-textDim">Vol </span><span className="text-tv-text">{formatVolume(ohlcv.volume)}</span></span>
      </div>
    </div>
  );
}

interface Ohlcv {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
