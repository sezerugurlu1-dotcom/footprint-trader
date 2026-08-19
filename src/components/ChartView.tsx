// Candlestick + volume chart using lightweight-charts (v5).
//
// Two chart panes:
//
//   Pane 0 (top, large):
//     - Candlestick series (the price action)
//     - VWAP overlay line (period-anchored, user-selectable)
//
//   Pane 1 (bottom, ~25% of total height):
//     - CVD line (cumulative volume delta, period-anchored)
//
// The bottom-of-chart delta stats bar (Vol · Δ · Δ Max · Δ Min) and
// the per-candle summary table still derive from the kline's
// built-in taker buy/sell split (Candle.takerBuyVolume, populated in
// binance/api.ts from field 9 of the REST response and `V` on the
// @kline WebSocket frame).

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
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
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import type { Candle, Interval, SymbolInfo } from '../types';
import { ChartLegend } from './ChartLegend';
import { DeltaStatsBar } from './DeltaStatsBar';
import { DeltaTable } from './DeltaTable';
import { VResizeHandle } from './VResizeHandle';
import { localCrosshairTimeFormatter, localTickMarkFormatter } from '../utils/timeFormat';
import { useVwap } from '../hooks/useVwap';
import { useCvd } from '../hooks/useCvd';
import { splitCvdBySlope } from '../utils/cvd';
import type { CvdPeriod, VwapPeriod } from '../utils/periodAnchors';

interface Props {
  symbol: SymbolInfo;
  /**
   * Current chart interval.  Used to force a full `setData()` on
   * interval change so the in-place `update()` fast path can never
   * fire for a candle from a different interval (which used to throw
   * "Cannot update oldest data" from lightweight-charts).
   */
  interval: Interval;
  candles: Candle[];
  lastPrice: number | null;
  latestVolume: number | null;
  /** Per-candle { max, min } delta from footprint per-level data.
   *  Drives the Δ Max / Δ Min rows of the bottom Footprint Summary
   *  table.  Candles missing from this map render "—" in those rows. */
  maxMinByTime: Record<number, { max: number; min: number }>;

  // Height of the bottom panel (DeltaStatsBar + DeltaTable) in
  // pixels.  Defaults to 140px when omitted.  The parent owns the
  // value and updates it via `onBottomPanelHeightChange` when the
  // user drags the resize handle.  Min/max are enforced by the
  // parent.
  bottomPanelHeight?: number;
  onBottomPanelHeightChange?: (h: number) => void;

  /** True when `symbol` is in the user's favourites list.  Drives
   *  the star button's filled/outline + colour state. */
  isFavorite?: boolean;
  /** Toggle favourite for `symbol`.  Wired to the ★ button in the
   *  top-left ChartLegend. */
  onToggleFavorite?: () => void;

  /** VWAP reset period.  Default 'session' (UTC-day, original
   *  behaviour). */
  vwapPeriod?: VwapPeriod;
  /** CVD reset period.  Default 'daily'. */
  cvdPeriod?: CvdPeriod;
}

export function ChartView({
  symbol, interval, candles, lastPrice, latestVolume, maxMinByTime,
  bottomPanelHeight = 140,
  onBottomPanelHeightChange,
  vwapPeriod = 'session',
  cvdPeriod = 'daily',
  isFavorite = false,
  onToggleFavorite = () => undefined,
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
  // Two parallel CVD series so we can colour each segment by its
  // sign.  The green (`up`) series is drawn first (under); the red
  // (`down`) series is drawn on top and overwrites the green only
  // on the segments that are actually down-moves.  See
  // utils/cvd.ts → splitCvdBySlope for the elbow logic.
  const cvdUpRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cvdDownRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Track the previously-applied interval so the data effects can
  // detect a switch and force `setData()` instead of `update()`.
  // lightweight-charts's `update()` validates that the new time is
  // greater than the previous max — when intervals change, the new
  // interval's last time can be older than the previous interval's
  // last time (e.g. 15m last = 16:45, 30m last = 16:30), which would
  // throw "Cannot update oldest data, last time=[object Object],
  // new time=[object Object]".  Forcing a full setData on every
  // interval change avoids this entirely.
  const prevIntervalRef = useRef<Interval | null>(null);
  // Track the previously-applied symbol so the data effects can
  // detect a switch and force `setData()` instead of `update()`.
  // Symbol changes are even sneakier than interval changes: the new
  // symbol's kline history spans the *same wall-clock time range*
  // as the old one (both go back "N intervals" from now), so the
  // first/last timestamps are identical and `isStructural` happily
  // returns false.  The effect then `update()`s only the last
  // candle, leaving the other 999 from the previous symbol on the
  // chart — the price scale looks "stuck" at the old range.
  const prevSymbolRef = useRef<string | null>(null);
  // Track the previously-applied VWAP and CVD periods so the
  // indicator effects can force `setData()` on period change.  A
  // period change is a content change (the running total resets at
  // a different boundary) but the candle shape is identical, so
  // without this guard the in-place `update()` fast path would
  // leave the previous-period line on the chart.
  const prevVwapPeriodRef = useRef<VwapPeriod | null>(null);
  const prevCvdPeriodRef = useRef<CvdPeriod | null>(null);

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
        // The candle pane takes the full pane height (5% top
        // margin preserved for the price-scale labels).  The CVD
        // indicator lives on its own pane below; it does not
        // share this price scale.
        scaleMargins: { top: 0.05, bottom: 0 },
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
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
    // conventional VWAP colour on most charting platforms.  Drawn
    // as a line across the full chart history (lightweight-charts
    // auto-fits the visible time range), not just at the last
    // candle.
    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'VWAP',
    });
    vwapRef.current = vwapSeries;

    // CVD pane (bottom).  Add a second pane for the cumulative
    // volume-delta line; the price-scale on this pane reads in
    // delta units (positive = net buy, negative = net sell), not
    // price units.  Set the pane to ~25% of the chart's pixel
    // height — the candles get the remaining ~75%.
    const cvdPane = chart.addPane();
    cvdPane.setHeight(120);

    // Green "up" series — drawn first (under).  Carries the CVD
    // title + the right-axis price label so the legend still reads
    // "CVD 1234" on hover.
    const cvdUpSeries = chart.addSeries(LineSeries, {
      color: '#26a69a',       // tv-green
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'CVD',
    }, 1);
    cvdUpRef.current = cvdUpSeries;

    // Red "down" series — drawn on top so it overwrites the green
    // on down-move segments.  No title / lastValue label of its
    // own (would duplicate the green series' legend entry).
    const cvdDownSeries = chart.addSeries(LineSeries, {
      color: '#ef5350',       // tv-red
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: '',
    }, 1);
    cvdDownRef.current = cvdDownSeries;

    const ro = new ResizeObserver(() => chart.applyOptions({ autoSize: true }));
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      setChart(null);
      candleRef.current = null;
      vwapRef.current = null;
      cvdUpRef.current = null;
      cvdDownRef.current = null;
    };
    // Intentionally empty deps: this effect runs once on mount to
    // create the chart instance.  `setChart` and `candleRef` etc are
    // stable refs / dispatchers; including them would just add noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guarantee a synchronous initial resize — ResizeObserver only fires on
  // *changes*, so the first paint can land before any chart layout exists
  // when the parent flex layout is still settling.
  const isEmpty = candles.length === 0;
  // Collapse the boolean to 0 / 1 so the dep is a literal, not a
  // complex expression (the linter is happier with a primitive).
  const emptyBucket = isEmpty ? 0 : 1;
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
  }, [emptyBucket]);

  // Update price precision when symbol changes
  useEffect(() => {
    if (!candleRef.current) return;
    candleRef.current.applyOptions({
      priceFormat: { type: 'price', precision: symbol.pricePrecision, minMove: symbol.tickSize },
    });
  }, [symbol.pricePrecision, symbol.tickSize, symbol.symbol]);

  // ── In-place series updates ──────────────────────────────────────
  // Two series remain on the chart: the candle series and the VWAP
  // overlay.  Both are derived from the same `candles` array and
  // have one point per candle, so each decides for itself:
  //
  //   * Structural change  →  setData()  (new candle appended, or
  //                          loadMore prepended older candles, or
  //                          the interval changed and the previous
  //                          data must be discarded).
  //                          O(N) — runs once per interval boundary.
  //   * Live tick          →  series.update(lastPoint) for each
  //                          series.  O(log N) on the chart's
  //                          internal time index.  Runs on every
  //                          WS message, which is the hot path.
  //
  // Per-series shape refs (not a single shared ref).  When the
  // candle effect commits its shape, the VWAP effect still has its
  // own empty prev-shape, so the first VWAP render correctly goes
  // through `setData()` instead of `update()`.  With a 250 ms tick
  // rate and a 2000-point array, keeping each series's hot-path
  // update() saves ~8 k array slots / second of GC pressure and a
  // full chart redraw per tick.
  //
  // `firstValue` (open for candles, VWAP value for the line) is part
  // of the shape so a *content* change is detected even when the
  // time skeleton (len / firstTime / lastTime) is identical.  This
  // is what makes a symbol switch work: when the user goes from
  // BTCUSDT to ETHUSDT, both instruments' 500 klines share the same
  // wall-clock range, so len / firstTime / lastTime all match and a
  // naive shape check would skip `setData()` and just `update()` the
  // last candle — leaving the other 499 from the old symbol on the
  // chart.  Tracking the first candle's value catches the swap.
  // A live tick only mutates the LAST candle, so `firstValue` is
  // stable on the hot path and we still get the O(log N) fast path.
  type Shape = { len: number; firstTime: number | null; firstValue: number | null; lastTime: number | null };
  const makeEmptyShape = (): Shape => ({ len: 0, firstTime: null, firstValue: null, lastTime: null });
  const candleShapeRef = useRef<Shape>(makeEmptyShape());
  const vwapShapeRef = useRef<Shape>(makeEmptyShape());
  const cvdShapeRef = useRef<Shape>(makeEmptyShape());
  const isStructural = <T extends { time: number }>(
    arr: ReadonlyArray<T>,
    prev: Shape,
    getFirstValue: (item: T) => number,
  ): boolean => {
    if (arr.length === 0) return prev.len !== 0;
    const firstTime = arr[0].time;
    const firstValue = getFirstValue(arr[0]);
    const lastTime = arr[arr.length - 1].time;
    return (
      arr.length !== prev.len ||
      firstTime !== prev.firstTime ||
      firstValue !== prev.firstValue ||
      lastTime !== prev.lastTime
    );
  };
  const commitShape = <T extends { time: number }>(
    arr: ReadonlyArray<T>,
    ref: MutableRefObject<Shape>,
    getFirstValue: (item: T) => number,
  ): void => {
    if (arr.length === 0) {
      ref.current = makeEmptyShape();
      return;
    }
    ref.current = {
      len: arr.length,
      firstTime: arr[0].time,
      firstValue: getFirstValue(arr[0]),
      lastTime: arr[arr.length - 1].time,
    };
  };

  // Update candle data — setData() on structural change, update()
  // on in-place live ticks.
  // `isStructural` / `commitShape` are defined inline above and
  // intentionally excluded from deps — they're stable within a
  // single render and the linter can't see that the closures they
  // capture are also stable.
  useEffect(() => {
    if (!candleRef.current) return;
    // Force a full reset whenever the interval changes, regardless
    // of shape equality.  The candle's last time on a 15m chart
    // can be the same as on a 30m chart (e.g. both end at the
    // current wall-clock minute) and the in-place `update()` would
    // happily overwrite the 15m value at that time with the 30m
    // value, leaving a mixed-data chart.  Even when the last time
    // does differ, the chart's internal time tracking can lag
    // behind ours and throw "Cannot update oldest data".  `setData`
    // is unconditionally safe.
    //
    // Same for symbol changes: the new symbol's kline history
    // covers the *same wall-clock range* as the old one, so the
    // first/last timestamps are identical and `isStructural`
    // returns false.  Without forcing `setData` here, only the
    // last candle of the new symbol reaches the chart and the
    // other 999 still belong to the old symbol — the price scale
    // appears stuck at the old range.
    const intervalChanged = prevIntervalRef.current !== null && prevIntervalRef.current !== interval;
    const symbolChanged = prevSymbolRef.current !== null && prevSymbolRef.current !== symbol.symbol;
    if (isStructural(candles, candleShapeRef.current, (c) => c.open) || intervalChanged || symbolChanged) {
      const cdata: CandlestickData[] = candles.map((c) => ({
        time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      candleRef.current.setData(cdata);
      // Re-fit the chart to the new data range.  Without these two
      // calls, switching from BTCUSDT (~64000) to a sub-$1 pair
      // (or from any symbol to a much-cheaper one) leaves the price
      // scale "stuck" at the previous symbol's range and the new
      // candles render off-screen.  Same for the time scale — a
      // different interval's history can sit outside the previous
      // visible window.
      chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
      chartRef.current?.timeScale().fitContent();
    } else if (candles.length > 0) {
      const c = candles[candles.length - 1];
      candleRef.current.update({
        time: c.time as Time,
        open: c.open, high: c.high, low: c.low, close: c.close,
      });
    }
    commitShape(candles, candleShapeRef, (c) => c.open);
    prevIntervalRef.current = interval;
    prevSymbolRef.current = symbol.symbol;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, symbol.symbol, interval]);

  // VWAP overlay line.  Recomputed on every candle change (initial
  // fetch, kline tick, loadMore, interval change) so the line is
  // always current.  `update()` on live ticks avoids the O(N)
  // setData() per WS message.  See the candle effect above for
  // why the dep-array exclusion is intentional.
  const vwap = useVwap(candles, vwapPeriod);
  useEffect(() => {
    if (!vwapRef.current) return;
    // Mirror the candle effect's structural-recompute logic: when
    // the interval or symbol changes, force a full setData even if
    // the time shape happens to be identical (the new VWAP values
    // belong to a different instrument / timeframe).  Same when
    // the VWAP period changes — the running total resets at a
    // different boundary, so the line's value at every candle
    // time is different from what was previously drawn.
    const intervalChanged = prevIntervalRef.current !== null && prevIntervalRef.current !== interval;
    const symbolChanged = prevSymbolRef.current !== null && prevSymbolRef.current !== symbol.symbol;
    const periodChanged = prevVwapPeriodRef.current !== null && prevVwapPeriodRef.current !== vwapPeriod;
    if (isStructural(vwap, vwapShapeRef.current, (p) => p.value) || intervalChanged || symbolChanged || periodChanged) {
      const vdata: LineData[] = vwap.map((p) => ({ time: p.time as Time, value: p.value }));
      vwapRef.current.setData(vdata);
    } else if (vwap.length > 0) {
      const p = vwap[vwap.length - 1];
      vwapRef.current.update({ time: p.time as Time, value: p.value });
    }
    commitShape(vwap, vwapShapeRef, (p) => p.value);
    prevVwapPeriodRef.current = vwapPeriod;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vwap, symbol.symbol, interval, vwapPeriod]);

  // CVD line on the second chart pane.  Same structural-recompute
  // logic as VWAP.  The `cvdPeriod` controls the reset boundary.
  // The points are split by slope into two parallel series (green
  // for up-moves, red for down-moves) so the line is coloured by
  // direction at every point.
  const cvd = useCvd(candles, cvdPeriod);
  useEffect(() => {
    if (!cvdUpRef.current || !cvdDownRef.current) return;
    const { up: cvdUp, down: cvdDown } = splitCvdBySlope(cvd);
    const intervalChanged = prevIntervalRef.current !== null && prevIntervalRef.current !== interval;
    const symbolChanged = prevSymbolRef.current !== null && prevSymbolRef.current !== symbol.symbol;
    const periodChanged = prevCvdPeriodRef.current !== null && prevCvdPeriodRef.current !== cvdPeriod;
    if (isStructural(cvd, cvdShapeRef.current, (p) => p.value) || intervalChanged || symbolChanged || periodChanged) {
      cvdUpRef.current.setData(cvdUp);
      cvdDownRef.current.setData(cvdDown);
    } else if (cvdUp.length > 0) {
      // Live tick — the last point of `up` is always the current
      // value.  `down` only needs an update when the new move was
      // a down move (so its last point is at the same time as up's
      // last point); if the new move was up, the red series is
      // unchanged and the green line already got the new value.
      const lastUp = cvdUp[cvdUp.length - 1];
      cvdUpRef.current.update({ time: lastUp.time as Time, value: lastUp.value });
      if (
        cvdDown.length > 0 &&
        cvdDown[cvdDown.length - 1].time === lastUp.time
      ) {
        const lastDown = cvdDown[cvdDown.length - 1];
        cvdDownRef.current.update({ time: lastDown.time as Time, value: lastDown.value });
      }
    }
    commitShape(cvd, cvdShapeRef, (p) => p.value);
    prevCvdPeriodRef.current = cvdPeriod;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvd, symbol.symbol, interval, cvdPeriod]);

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
          symbol={symbol}
          isFavorite={isFavorite ?? false}
          onToggleFavorite={onToggleFavorite ?? (() => undefined)}
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
