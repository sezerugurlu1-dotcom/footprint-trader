// Candlestick + volume chart using lightweight-charts.
// Footprint overlay is intentionally NOT rendered here.  The
// per-level data is still computed in useFootprintData and fed into
// the delta stats + table at the bottom of the chart.
//
// The bottom-of-chart delta stats bar (Vol · Δ · Δ Max · Δ Min) and
// the per-candle delta histogram (at the very bottom of the chart)
// both derive from the kline's built-in taker buy/sell split
// (Candle.takerBuyVolume, populated in binance/api.ts from field 9 of
// the REST response and `V` on the @kline WebSocket frame).  This
// gives accurate per-candle delta for the entire loaded history
// without any aggTrades backfill or WebSocket.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  IChartApi,
  ISeriesApi,
  Time,
  CandlestickData,
  LineData,
  HistogramData,
} from 'lightweight-charts';
import type { Candle, SymbolInfo } from '../types';
import { ChartLegend } from './ChartLegend';
import { DeltaStatsBar } from './DeltaStatsBar';
import { DeltaTable } from './DeltaTable';
import { VResizeHandle } from './VResizeHandle';
import { localCrosshairTimeFormatter, localTickMarkFormatter } from '../utils/timeFormat';
import { useVwap } from '../hooks/useVwap';
import { useCvd } from '../hooks/useCvd';
import { useCvdByPrice } from '../hooks/useCvdByPrice';
import { autoBinSize } from '../utils/cvdByPrice';

interface Props {
  symbol: SymbolInfo;
  candles: Candle[];
  lastPrice: number | null;
  latestVolume: number | null;
  /** Per-candle { max, min } delta from footprint per-level data.
   *  Drives the Δ Max / Δ Min rows of the bottom Footprint Summary
   *  table.  Candles missing from this map render "—" in those rows. */
  maxMinByTime: Record<number, { max: number; min: number }>;

  // Indicator visibility.  All default to true so that callers
  // that don't pass them still get the full chart.  `false`
  // applies `series.applyOptions({ visible: false })` so the
  // series keeps its data and toggles back on instantly — no
  // re-computation needed.
  showVwap?: boolean;
  showCvd?: boolean;
  showCvdByPrice?: boolean;

  // CVD-by-Price bin size in price units.  When omitted, a
  // sensible default is derived from the symbol + latest close
  // (see the useMemo block below).
  cvdBinSize?: number;

  // Height of the bottom panel (DeltaStatsBar + DeltaTable) in
  // pixels.  Defaults to 140px when omitted.  The parent owns the
  // value and updates it via `onBottomPanelHeightChange` when the
  // user drags the resize handle.  Min/max are enforced by the
  // parent.
  bottomPanelHeight?: number;
  onBottomPanelHeightChange?: (h: number) => void;

  // Multiplier for the combined height of the two CVD strips
  // (the time-based CVD line and the CVD-by-Price histogram) at
  // the bottom of the chart.  1 = the original 20% of chart
  // height (8% CVD line + 12% CVD-by-Price).  0.5 = half,
  // 2 = double.  The parent owns the value and updates it via
  // `onCvdStripScaleChange`.  Applied by an effect that rewrites
  // the scaleMargins of all three price scales together.
  cvdStripScale?: number;
  onCvdStripScaleChange?: (s: number) => void;
}

export function ChartView({
  symbol, candles, lastPrice, latestVolume, maxMinByTime,
  showVwap = true, showCvd = true, showCvdByPrice = true,
  cvdBinSize: cvdBinSizeProp,
  bottomPanelHeight = 140,
  onBottomPanelHeightChange,
  cvdStripScale = 1,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Mirror of `chartRef.current` as state, so child components that
  // need the live chart instance (ChartLegend's hover handler, the
  // DeltaTable's `timeToCoordinate` alignment) re-render once the
  // chart has actually been created.  Refs alone don't trigger
  // re-renders, so we'd otherwise pass `null` forever.
  const [chart, setChart] = useState<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cvdRef = useRef<ISeriesApi<'Line'> | null>(null);
  // Redesigned CVD-by-Price: a histogram of per-bin cumulative delta
  // (see utils/cvdByPrice.ts).  One bar per (candle, price-bin), so
  // the per-bar colour comes from the data point, not from the
  // series-level options.
  const cvdByPriceRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e11' },
        textColor: '#787b86',
        fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(54, 58, 70, 0.3)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(54, 58, 70, 0.3)', style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#787b86', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#2962ff' },
        horzLine: { color: '#787b86', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#2962ff' },
      },
      rightPriceScale: {
        borderColor: '#1e222d',
        // Bottom margin now reserves vertical space for BOTH the
        // redesigned CVD-by-Price histogram (just above the time-
        // based CVD line) and the original CVD line at the very
        // bottom.  Layout from top to bottom:
        //   candles:          0% → 80%   (rightPriceScale)
        //   CVD-by-Price:    80% → 92%   (priceScaleId 'cvd-bp')
        //   CVD line:        92% → 100%  (priceScaleId 'cvd')
        // The 1% gap between strips is the price-scale border line.
        scaleMargins: { top: 0.05, bottom: 0.20 },
        textColor: '#787b86',
      },
      timeScale: {
        borderColor: '#1e222d',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        // Convert UTC seconds -> user's local time for the x-axis labels.
        tickMarkFormatter: localTickMarkFormatter,
      },
      // Same conversion for the crosshair's horizontal-axis badge
      // (the floating "12:35" that follows the cursor).
      localization: {
        locale: 'en-GB',
        timeFormatter: localCrosshairTimeFormatter,
      },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      priceFormat: { type: 'price', precision: symbol.pricePrecision, minMove: symbol.tickSize },
    });
    candleRef.current = candleSeries;

    // Publish the chart to state so children (ChartLegend hover, DeltaTable
    // candle-aligned columns) re-render with a real IChartApi handle.
    chartRef.current = chart;
    setChart(chart);

    // VWAP overlay on the main price scale.  Amber is the
    // conventional VWAP colour on most charting platforms.
    const vwapSeries = chart.addLineSeries({
      color: '#fbbf24',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'VWAP',
    });
    vwapRef.current = vwapSeries;

    // CVD line on its own thin strip at the very bottom of the
    // chart.  Lives on a dedicated price scale so its absolute
    // units (cumulative delta, which can be positive or negative)
    // don't fight the main price scale.
    const cvdSeries = chart.addLineSeries({
      color: '#60a5fa',
      lineWidth: 2,
      priceScaleId: 'cvd',
      priceLineVisible: false,
      lastValueVisible: true,
      // Same reasoning as the histogram below: this scale shows
      // cumulative-delta values, not prices, so use a volume-style
      // axis label.
      priceFormat: { type: 'volume', precision: 0, minMove: 1 },
      title: 'CVD',
    });
    cvdSeries.priceScale().applyOptions({
      // Bottom 8% of the chart.  The last 2% is the price-scale
      // border line.
      scaleMargins: { top: 0.92, bottom: 0 },
    });
    cvdRef.current = cvdSeries;

    // CVD-by-Price (redesign of the CVD): a histogram on its own
    // dedicated price scale stacked directly above the time-based
    // CVD line.  Each bar's colour is set per-data-point (green for
    // positive cumulative delta at that price bin, red for
    // negative) to match the reference image.  The bar value is
    // the per-bin cumulative delta in the current UTC session, and
    // the series auto-resets to zero at every daily boundary by
    // design.
    const cvdByPriceSeries = chart.addHistogramSeries({
      // Series-level colour is only the fallback; per-bar colours
      // attached in the data override this.
      color: 'rgba(38, 166, 154, 0.55)',
      priceScaleId: 'cvd-bp',
      priceLineVisible: false,
      lastValueVisible: true,
      // The cvd-bp scale shows CUMULATIVE DELTA values, not prices.
      // Use a plain number format so axis labels read like
      // "+1.2K" / "-450" instead of a fake price.  `minMove: 1`
      // and `precision: 0` give clean integers; auto-precision
      // via `formatter` would be nicer but `volume` is the closest
      // built-in type and is good enough for most deltas.
      priceFormat: { type: 'volume', precision: 0, minMove: 1 },
      title: 'CVD Δ Price',
    });
    cvdByPriceSeries.priceScale().applyOptions({
      // Middle 12% of the chart, sandwiched between the candle
      // area (top 80%) and the CVD line (bottom 8%).
      scaleMargins: { top: 0.80, bottom: 0.08 },
    });
    cvdByPriceRef.current = cvdByPriceSeries;

    const ro = new ResizeObserver(() => chart.applyOptions({ autoSize: true }));
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      setChart(null);
      candleRef.current = null;
      vwapRef.current = null;
      cvdRef.current = null;
      cvdByPriceRef.current = null;
    };
  }, []);

  // Guarantee a synchronous initial resize — ResizeObserver only fires on
  // *changes*, so the first paint can land before any chart layout exists
  // when the parent flex layout is still settling.
  useLayoutEffect(() => {
    const c = containerRef.current;
    const chart = chartRef.current;
    if (!c || !chart) return;
    const tryResize = () => {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        chart.applyOptions({ width: r.width, height: r.height, autoSize: true });
        return true;
      }
      return false;
    };
    if (tryResize()) return;
    let raf = 0;
    let tries = 0;
    const tick = () => {
      if (tryResize()) return;
      if (++tries < 30) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [candles.length === 0 ? 0 : 1]);

  // Update price precision when symbol changes
  useEffect(() => {
    if (!candleRef.current) return;
    candleRef.current.applyOptions({
      priceFormat: { type: 'price', precision: symbol.pricePrecision, minMove: symbol.tickSize },
    });
  }, [symbol.pricePrecision, symbol.tickSize, symbol.symbol]);

  // Update candle data
  useEffect(() => {
    if (!candleRef.current) return;
    const cdata: CandlestickData[] = candles.map((c) => ({
      time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    candleRef.current.setData(cdata);
  }, [candles, symbol.symbol]);

  // VWAP overlay line.  Recomputed on every candle change (initial
  // fetch, kline tick, loadMore) so the line is always current.
  // setData() is O(N) but with 500-2000 points it stays well under
  // a frame; same trade-off the candle/volume series make.
  const vwap = useVwap(candles);
  useEffect(() => {
    if (!vwapRef.current) return;
    const vdata: LineData[] = vwap.map((p) => ({ time: p.time as Time, value: p.value }));
    vwapRef.current.setData(vdata);
  }, [vwap, symbol.symbol]);

  // CVD line on its own scale.  Same update pattern as VWAP.
  const cvd = useCvd(candles);
  useEffect(() => {
    if (!cvdRef.current) return;
    const cdata: LineData[] = cvd.map((p) => ({ time: p.time as Time, value: p.value }));
    cvdRef.current.setData(cdata);
  }, [cvd, symbol.symbol]);

  // CVD-by-Price: redesigned indicator.  One histogram bar per
  // (candle, price-bin) point, coloured green for positive
  // cumulative delta and red/purple for negative.
  //
  // Bin size comes from the parent (App.tsx) which lets the user
  // pick from Auto / Fine / Medium / Coarse / Manual.  When the
  // prop is omitted (e.g. when ChartView is used without the full
  // App wrapper) we fall back to `autoBinSize`, which targets
  // ~80 visible bins across the candle range.  This is a much
  // better default than the old `price * 0.001` heuristic, which
  // ignored the actual range and could still over-resolve for
  // symbols with tiny tick sizes.
  const cvdByPriceBin = useMemo(() => {
    if (
      cvdBinSizeProp !== undefined &&
      Number.isFinite(cvdBinSizeProp) &&
      cvdBinSizeProp > 0
    ) {
      return cvdBinSizeProp;
    }
    return autoBinSize(candles, {
      tickSize: symbol.tickSize || 0.01,
      targetBins: 80,
    });
  }, [cvdBinSizeProp, symbol.tickSize, symbol.symbol, candles]);
  const cvdByPrice = useCvdByPrice(candles, { binSize: cvdByPriceBin });
  useEffect(() => {
    if (!cvdByPriceRef.current) return;
    // Colour palette mirrors the reference image:
    //   green  = net buy pressure at that price bin
    //   red    = net sell pressure at that price bin
    // Faint transparency so overlapping bins read as a profile
    // instead of opaque blocks.
    const POS = 'rgba(38, 166, 154, 0.55)';   // tv green
    const NEG = 'rgba(239, 83, 80, 0.55)';    // tv red
    const ZERO = 'rgba(120, 123, 134, 0.35)'; // dim grey
    const cdata: HistogramData[] = cvdByPrice.map((p) => ({
      time: p.time as Time,
      value: p.delta,
      color: p.delta > 0 ? POS : p.delta < 0 ? NEG : ZERO,
    }));
    cvdByPriceRef.current.setData(cdata);
  }, [cvdByPrice, symbol.symbol]);

  // Apply indicator visibility.  `applyOptions({ visible })` is
  // a cheap runtime toggle — the series keeps its data so flipping
  // it back on is instant, no recompute.
  useEffect(() => {
    vwapRef.current?.applyOptions({ visible: showVwap });
  }, [showVwap]);
  useEffect(() => {
    cvdRef.current?.applyOptions({ visible: showCvd });
  }, [showCvd]);
  useEffect(() => {
    cvdByPriceRef.current?.applyOptions({ visible: showCvdByPrice });
  }, [showCvdByPrice]);

  // Apply the CVD-strip scale to all three price scales.  We do it
  // in one effect so the layout updates atomically — the candle
  // area, the CVD-by-Price histogram and the CVD line all grow or
  // shrink together in proportion.  Math:
  //   baseCvdArea = 0.20 (8% CVD line + 12% CVD-by-Price)
  //   cvdArea     = baseCvdArea * scale
  //   cvdBpArea   = 0.12 * scale   (60% of cvdArea)
  //   cvdArea2    = 0.08 * scale   (40% of cvdArea)
  //   mainRightScale.bottom = cvdArea
  //   cvdBpScale:           top = cvdArea,    bottom = cvdArea2
  //   cvdScale:             top = cvdArea + cvdBpArea, bottom = 0
  useEffect(() => {
    const scale = Number.isFinite(cvdStripScale) && cvdStripScale > 0
      ? cvdStripScale
      : 1;
    const cvdArea = 0.20 * scale;
    const cvdBpArea = 0.12 * scale;
    const cvdLineArea = 0.08 * scale;
    chartRef.current?.priceScale('right').applyOptions({
      scaleMargins: { top: 0.05, bottom: cvdArea },
    });
    cvdByPriceRef.current?.priceScale().applyOptions({
      scaleMargins: { top: cvdArea, bottom: cvdLineArea },
    });
    cvdRef.current?.priceScale().applyOptions({
      scaleMargins: { top: cvdArea + cvdBpArea, bottom: 0 },
    });
  }, [cvdStripScale]);

  // Last-price horizontal line — single instance, update in place
  const priceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  useEffect(() => {
    if (!candleRef.current) return;
    if (priceLineRef.current) {
      try { candleRef.current.removePriceLine(priceLineRef.current); } catch { /* */ }
      priceLineRef.current = null;
    }
    if (lastPrice == null) return;
    priceLineRef.current = candleRef.current.createPriceLine({
      price: lastPrice,
      color: '#2962ff',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `${lastPrice.toFixed(symbol.pricePrecision)}`,
    });
    return () => {
      if (priceLineRef.current && candleRef.current) {
        try { candleRef.current.removePriceLine(priceLineRef.current); } catch { /* */ }
        priceLineRef.current = null;
      }
    };
  }, [lastPrice, symbol.symbol, symbol.pricePrecision]);

  const latest = candles.length ? candles[candles.length - 1] : null;
  const latestView = latest ? { ...latest } : null;

  // Bottom-bar deltas: computed inline from the kline's taker-buy
  // split (delta = 2 × takerBuyVolume − volume), covering the last 20
  // loaded candles.
  const DELTA_WINDOW = 20;
  const lastN = candles.slice(-DELTA_WINDOW);
  const lastNValues = lastN.map((c) => 2 * c.takerBuyVolume - c.volume);
  const currentDeltaBar = lastNValues.length ? lastNValues[lastNValues.length - 1] : 0;
  const maxDeltaBar = lastNValues.length ? Math.max(...lastNValues) : 0;
  const minDeltaBar = lastNValues.length ? Math.min(...lastNValues) : 0;

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="absolute inset-0" />
        <ChartLegend
          chart={chart}
          candleSeries={candleRef.current}
          candles={candles}
          latest={latestView}
          precision={symbol.pricePrecision}
        />
      </div>
      <VResizeHandle
        onDelta={(deltaY) => {
          if (!onBottomPanelHeightChange) return;
          // Clamp to a sensible range: 60px (just the stats bar) →
          // 480px (most of the screen for a tall table).
          const next = Math.max(
            60,
            Math.min(480, bottomPanelHeight + deltaY),
          );
          onBottomPanelHeightChange(next);
        }}
        ariaLabel="Resize the bottom delta panel"
      />
      <div
        className="flex-shrink-0 flex flex-col"
        style={{ height: bottomPanelHeight }}
      >
        <DeltaStatsBar
          volume={latestVolume}
          currentDelta={currentDeltaBar}
          maxDelta={maxDeltaBar}
          minDelta={minDeltaBar}
          windowSize={DELTA_WINDOW}
        />
        <DeltaTable
          candles={candles}
          maxMinByTime={maxMinByTime}
          chart={chart}
          height={Math.max(0, bottomPanelHeight - 24)}
        />
      </div>
    </div>
  );
}
