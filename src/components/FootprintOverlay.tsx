// Canvas overlay that draws the footprint (per-level buy/sell volume) on top
// of the candlestick chart. Recomputes layout on every frame the chart
// (or footprint data) emits a visible-range change.

import { useEffect, useRef } from 'react';
import { IChartApi, ISeriesApi, Time, MouseEventParams } from 'lightweight-charts';
import type { FootprintCandle, FootprintLevel } from '../types';
import { detectDivergence, type FootprintBuilder } from '../utils/footprint';

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  builder: FootprintBuilder | null;
  show: boolean;
  showImbalance: boolean;
  showDivergence: boolean;
}

const BID_COLOR = 'rgba(38, 166, 154, 0.85)';   // green
const ASK_COLOR = 'rgba(239, 83, 80, 0.85)';    // red
const POC_BG    = 'rgba(41, 98, 255, 0.18)';
const TEXT      = '#d1d4dc';
const SEP       = 'rgba(54, 58, 70, 0.6)';

const FONT = '11px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const LEVEL_HEIGHT_MIN = 12;
const LEVEL_HEIGHT_MAX = 26;
const ROW_PAD = 1;
const MIN_CANDLE_WIDTH_FOR_LEVELS = 30;  // P3 #17: responsive fallback

function findPOC(c: FootprintCandle): FootprintLevel | null {
  let best: FootprintLevel | null = null;
  for (const l of c.levels) {
    if (!best || l.bidVol + l.askVol > best.bidVol + best.askVol) best = l;
  }
  return best;
}

function fmtVol(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  if (v >= 1)    return v.toFixed(v >= 100 ? 0 : 1);
  return v.toFixed(2);
}

// priceToCoordinate in v4 returns number | null on the series.
function priceToCoordinateSafe(series: ISeriesApi<'Candlestick'>, price: number): number | null {
  try {
    return series.priceToCoordinate(price);
  } catch {
    return null;
  }
}

export function FootprintOverlay({ chart, series, builder, show, showImbalance, showDivergence }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef   = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!show || !chart || !series || !builder || !wrapRef.current || !canvasRef.current) return;

    const container = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    // Match canvas backing store to container size with DPR.
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = container.getBoundingClientRect();
      canvas.width  = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      canvas.style.width  = r.width + 'px';
      canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      requestDraw();
    };

    // rAF coalescer — P1 #1 + P3 #29
    let pending = false;
    const requestDraw = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        try { draw(); } finally { pending = false; }
      });
    };

    const draw = () => {
      const r = container.getBoundingClientRect();
      const w = r.width, h = r.height;
      ctx.clearRect(0, 0, w, h);  // P3 #24: clearRect needed (transparent overlay above opaque chart)

      const tsScale = chart.timeScale();

      // Determine visible time window from pixel range, then ask builder
      // for only the candles in that window — P1 #1.
      const allRange = builder.getCandleTimeRange();
      if (!allRange) return;
      const coordFrom = tsScale.coordinateToTime(0);
      const coordTo   = tsScale.coordinateToTime(w);
      const tStart = coordFrom !== null ? Math.floor(coordFrom as number) : allRange.from;
      const tEnd   = coordTo   !== null ? Math.floor(coordTo   as number) : allRange.to;
      if (tEnd < tStart) return;

      const fpCandles = builder.build({ from: tStart, to: tEnd + 1 });
      if (!fpCandles.length) return;

      // Map time -> index in fpCandles for fast next-candle lookup.
      const timeToIndex = new Map<number, number>();
      fpCandles.forEach((c, i) => timeToIndex.set(c.time, i));

      // Compute max combined volume per price level across visible candles —
      // used to scale bar widths so the largest bar fills its half.
      let maxLevelVol = 0;
      for (const c of fpCandles) {
        for (const l of c.levels) {
          const sum = l.bidVol + l.askVol;
          if (sum > maxLevelVol) maxLevelVol = sum;
        }
      }
      if (maxLevelVol <= 0) return;

      for (const c of fpCandles) {
        const xCenter = tsScale.timeToCoordinate(c.time as Time);
        if (xCenter === null) continue;

        const idx = timeToIndex.get(c.time)!;
        const next = fpCandles[idx + 1];
        const xRight = next ? tsScale.timeToCoordinate(next.time as Time) : xCenter + 60;
        if (xRight === null) continue;
        const candleWidth = xRight - xCenter;
        if (candleWidth < 4) continue;

        // P3 #17: responsive — small candles only get POC + totals, no per-level bars
        if (candleWidth < MIN_CANDLE_WIDTH_FOR_LEVELS) {
          drawTotals(ctx, c, xCenter, candleWidth, priceToCoordinateSafe, series);
          continue;
        }

        const halfW = Math.max(2, candleWidth / 2 - 1);
        const xLeft = xCenter - halfW;

        // Derive per-row height from pixel distance between adjacent levels.
        const ys: number[] = [];
        for (const l of c.levels) {
          const y = priceToCoordinateSafe(series, l.price);
          if (y !== null) ys.push(y);
        }
        let rowH = 14;
        if (ys.length >= 2) {
          // Levels sorted desc by price -> y ascending (lower price -> larger y).
          let total = 0;
          for (let i = 1; i < ys.length; i++) total += Math.abs(ys[i] - ys[i - 1]);
          rowH = Math.min(LEVEL_HEIGHT_MAX, Math.max(LEVEL_HEIGHT_MIN, total / (ys.length - 1)));
        }

        // price -> y cache for the row loop below
        const priceYMap = new Map<number, number>();
        for (const l of c.levels) {
          const y = priceToCoordinateSafe(series, l.price);
          if (y !== null) priceYMap.set(l.price, y);
        }

        const poc = findPOC(c);

        // Row-by-row drawing.
        for (const l of c.levels) {
          const y = priceYMap.get(l.price);
          if (y === undefined) continue;
          const rowTop = y - rowH / 2;
          const rowBot = y + rowH / 2;

          // Subtle separator
          ctx.fillStyle = SEP;
          ctx.fillRect(xLeft, rowBot, candleWidth, 0.5);

          // POC background
          if (poc && poc.price === l.price) {
            ctx.fillStyle = POC_BG;
            ctx.fillRect(xLeft, rowTop, candleWidth, rowH);
          }

          // Bid bar (left half)
          const bidFrac = l.bidVol / maxLevelVol;
          const askFrac = l.askVol / maxLevelVol;
          const bidW = Math.max(l.bidVol > 0 ? 3 : 0, bidFrac * halfW);
          const askW = Math.max(l.askVol > 0 ? 3 : 0, askFrac * halfW);

          ctx.fillStyle = BID_COLOR;
          ctx.fillRect(xCenter - bidW, rowTop + ROW_PAD, bidW, rowH - 2 * ROW_PAD);

          ctx.fillStyle = ASK_COLOR;
          ctx.fillRect(xCenter, rowTop + ROW_PAD, askW, rowH - 2 * ROW_PAD);

          // Texts
          ctx.font = FONT;
          ctx.textBaseline = 'middle';

          if (l.bidVol > 0) {
            ctx.fillStyle = TEXT;
            ctx.textAlign = 'right';
            ctx.fillText(fmtVol(l.bidVol), xCenter - bidW - 4, y);
          }
          if (l.askVol > 0) {
            ctx.fillStyle = TEXT;
            ctx.textAlign = 'left';
            ctx.fillText(fmtVol(l.askVol), xCenter + askW + 4, y);
          }

          // Imbalance marker
          if (showImbalance && l.bidVol > 0 && l.askVol > 0) {
            const minV = Math.min(l.bidVol, l.askVol);
            const maxV = Math.max(l.bidVol, l.askVol);
            if (maxV / Math.max(minV, 1e-9) >= 3) {
              ctx.fillStyle = l.bidVol > l.askVol ? BID_COLOR : ASK_COLOR;
              ctx.textAlign = 'center';
              ctx.fillText(l.bidVol > l.askVol ? '◀' : '▶', xCenter, y);
            }
          }
        }

        // Bottom totals row
        const totalY = priceToCoordinateSafe(series, c.low - (rowH * 0.6));
        if (totalY !== null) {
          ctx.fillStyle = 'rgba(19, 23, 34, 0.92)';
          ctx.fillRect(xLeft, totalY - 9, candleWidth, 18);
          ctx.fillStyle = BID_COLOR;
          ctx.textAlign = 'right';
          ctx.fillText('▲ ' + fmtVol(c.totalBid), xCenter - 4, totalY);
          ctx.fillStyle = ASK_COLOR;
          ctx.textAlign = 'left';
          ctx.fillText('▼ ' + fmtVol(c.totalAsk), xCenter + 4, totalY);

          // Delta badge
          const d = c.delta;
          ctx.fillStyle = d >= 0 ? BID_COLOR : ASK_COLOR;
          ctx.textAlign = 'center';
          const sign = d >= 0 ? '+' : '';
          ctx.fillText('Δ ' + sign + fmtVol(d), xCenter, totalY + (rowH > 18 ? 14 : 0));
        }
      }

      // ── Delta divergence markers ──────────────────────────────────────
      // Classic order-flow signal: price makes a new extreme but the
      // matching delta fails to confirm. Drawn AFTER the footprint so
      // it sits on top of the candle.
      if (showDivergence && fpCandles.length >= 4) {
        const markers = detectDivergence(fpCandles);
        if (markers.length) {
          ctx.save();
          ctx.font = 'bold 14px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';

          for (const m of markers) {
            const xC = tsScale.timeToCoordinate(m.time as Time);
            if (xC === null) continue;

            if (m.kind === 'bearish') {
              // Red ▼ just above the candle's high.
              const yExtreme = priceToCoordinateSafe(series, m.priceExtreme);
              if (yExtreme === null) continue;
              const y = yExtreme - 14;
              // Subtle dark pill behind the glyph for legibility.
              ctx.fillStyle = 'rgba(11, 14, 17, 0.85)';
              ctx.beginPath();
              ctx.arc(xC, y, 9, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#ef5350';
              ctx.fillText('▼', xC, y);
            } else {
              // Green ▲ just below the candle's low.
              const yExtreme = priceToCoordinateSafe(series, m.priceExtreme);
              if (yExtreme === null) continue;
              const y = yExtreme + 14;
              ctx.fillStyle = 'rgba(11, 14, 17, 0.85)';
              ctx.beginPath();
              ctx.arc(xC, y, 9, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#26a69a';
              ctx.fillText('▲', xC, y);
            }
          }
          ctx.restore();
        }
      }
    };

    const onRangeChange = () => requestDraw();
    const onVisible = (_p: MouseEventParams) => requestDraw();

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // P1 #1: only one logical-range subscription, drop the redundant
    // visibleTimeRangeChange (logical covers it).
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    chart.subscribeCrosshairMove(onVisible);
    // Re-draw periodically in case of trade updates without any chart interaction.
    const interval = setInterval(requestDraw, 750);

    return () => {
      ro.disconnect();
      clearInterval(interval);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange); } catch { /* */ }
      try { chart.unsubscribeCrosshairMove(onVisible); } catch { /* */ }
    };
  }, [chart, series, builder, show, showImbalance, showDivergence]);

  if (!show) return null;

  return (
    <div ref={wrapRef} className="footprint-canvas-wrap" style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
    }}>
      <canvas ref={canvasRef} className="footprint-canvas" />
    </div>
  );
}

// Compact totals-only drawing for very narrow candles (P3 #17).
function drawTotals(
  ctx: CanvasRenderingContext2D,
  c: FootprintCandle,
  xCenter: number,
  candleWidth: number,
  safe: (s: ISeriesApi<'Candlestick'>, p: number) => number | null,
  series: ISeriesApi<'Candlestick'>,
) {
  const rowH = 18;
  const totalY = safe(series, c.low - (rowH * 0.6));
  if (totalY === null) return;
  const xLeft = xCenter - candleWidth / 2;
  ctx.fillStyle = 'rgba(19, 23, 34, 0.92)';
  ctx.fillRect(xLeft, totalY - 9, candleWidth, 18);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = BID_COLOR;
  ctx.textAlign = 'right';
  ctx.fillText('▲' + fmtVol(c.totalBid), xCenter - 2, totalY);
  ctx.fillStyle = ASK_COLOR;
  ctx.textAlign = 'left';
  ctx.fillText('▼' + fmtVol(c.totalAsk), xCenter + 2, totalY);
}
