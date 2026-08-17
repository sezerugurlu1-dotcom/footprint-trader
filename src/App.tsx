// Lean chart shell: toolbar, candlestick + volume chart, ticker, order book.
// Footprint / per-level order flow is intentionally disabled in this build —
// the source lives in src/utils/footprint.ts and src/components/FootprintOverlay.tsx
// for a follow-up session.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { ChartView } from './components/ChartView';
import { TickerInfo } from './components/TickerInfo';
import { OrderBookPanel } from './components/OrderBookPanel';
import { useBinanceData } from './hooks/useBinanceData';
import { useFootprintData } from './hooks/useFootprintData';
import { fetchExchangeInfo } from './binance/api';
import type { Interval, SymbolInfo } from './types';
import { autoBinSize } from './utils/cvdByPrice';

/**
 * Bin-size preset for the redesigned CVD-by-Price indicator.
 *  - `auto`   : derived from the candle range + symbol tick
 *  - `fine`   : auto / 4   (4× more bins, denser profile)
 *  - `medium` : auto       (≈80 visible bins, the auto value)
 *  - `coarse` : auto × 4   (4× fewer bins, chunkier profile)
 *  - `manual` : use `cvdBinManual` (a number entered by the user)
 */
export type CvdBinMode = 'auto' | 'fine' | 'medium' | 'coarse' | 'manual';

/** Multipliers applied to the `auto` value for each preset. */
const CVD_BIN_MULTIPLIER: Record<Exclude<CvdBinMode, 'auto' | 'manual'>, number> = {
  fine: 0.25,
  medium: 1,
  coarse: 4,
};

const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT',
  'ARBUSDT', 'OPUSDT', 'APTUSDT', 'SUIUSDT', 'TONUSDT',
];

export default function App() {
  const [exchangeInfo, setExchangeInfo] = useState<Record<string, SymbolInfo> | null>(null);
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [interval, setInterval] = useState<Interval>('15m');

  // Indicator visibility — separate from data state so toggling
  // doesn't re-fetch candles.  Defaults: all on.
  const [showVwap, setShowVwap] = useState(true);
  const [showCvd, setShowCvd] = useState(true);
  const [showCvdByPrice, setShowCvdByPrice] = useState(true);
  // CVD-by-Price bin-size mode.  `auto` derives the bin from the
  // actual price range (recommended); the other modes are explicit
  // multipliers on top of `auto` so the user can pick finer or
  // chunkier profiles without having to enter a number.
  const [cvdBinMode, setCvdBinMode] = useState<CvdBinMode>('auto');
  // Manual bin size, used only when `cvdBinMode === 'manual'`.
  const [cvdBinManual, setCvdBinManual] = useState<number>(1);

  // Resizable bottom panel (DeltaStatsBar + DeltaTable).  The
  // user drags the handle above the panel to change this value;
  // 140px is a comfortable default that shows the four table
  // rows clearly.  Clamping happens in the VResizeHandle's
  // parent effect, not here.
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(140);

  // CVD-strip scale: 1.0 means the combined CVD line + CVD-by-Price
  // histogram take up the original 20% of the chart height (8% +
  // 12%).  0.5 = half, 2.0 = double.  Owned here, applied inside
  // ChartView via scaleMargins.
  const [cvdStripScale, setCvdStripScale] = useState<number>(1);

  useEffect(() => {
    fetchExchangeInfo()
      .then(setExchangeInfo)
      .catch((e) => console.error('exchangeInfo failed', e));
  }, []);

  // While we wait for full exchange info, use a sensible default tick.
  const symbolInfo: SymbolInfo | null = useMemo(() => {
    const real = exchangeInfo?.[symbol];
    if (real) return real;
    return {
      symbol,
      baseAsset: symbol.replace(/USDT$|USDC$/, ''),
      quoteAsset: symbol.endsWith('USDT') ? 'USDT' : 'USDC',
      pricePrecision: 2,
      quantityPrecision: 3,
      tickSize: symbol === 'BTCUSDT' ? 0.1 : symbol === 'ETHUSDT' ? 0.01 : 0.01,
    };
  }, [exchangeInfo, symbol]);

  const {
    candles, lastPrice, status, source, lastUpdateAt, messageCount, pollCount,
    loading, loadingMore, error, reconnect, loadMore,
  } = useBinanceData(symbolInfo, interval);

  // Per-level order-flow data — feeds the Δ Max / Δ Min columns of the
  // Footprint Summary table.  Backfill is bounded to ~50k most recent
  // trades (the 2-day Binance aggTrades window) so the table will
  // show real values for recent candles and "—" for older ones.
  const { maxMinByTime } = useFootprintData(symbolInfo, interval, candles);

  const latestVolume = candles.length ? candles[candles.length - 1].volume : null;

  const symbolList = useMemo(() => {
    if (exchangeInfo) {
      return Object.keys(exchangeInfo)
        .filter((s) => s.endsWith('USDT'))
        .sort();
    }
    return DEFAULT_SYMBOLS;
  }, [exchangeInfo]);

  // CVD-by-Price bin size, derived from the user's preset + the
  // candle data.  Recomputed only when the preset, the manual
  // value, the symbol (tick size) or the candle set changes.
  const cvdBinSize = useMemo(() => {
    const tick = symbolInfo?.tickSize ?? 0.01;
    if (cvdBinMode === 'manual') {
      return Number.isFinite(cvdBinManual) && cvdBinManual > 0
        ? cvdBinManual
        : tick;
    }
    const auto = autoBinSize(candles, { tickSize: tick, targetBins: 80 });
    // `auto` is the same as `medium` (×1); for clarity we use the
    // explicit multiplier when one exists and fall back to 1.
    const mult =
      cvdBinMode === 'auto' ? 1 : CVD_BIN_MULTIPLIER[cvdBinMode];
    return auto * mult;
  }, [cvdBinMode, cvdBinManual, symbolInfo, candles]);

  // Stable setters for Toolbar.
  const onSymbol = useCallback((s: string) => setSymbol(s), []);
  const onInterval = useCallback((i: Interval) => setInterval(i), []);
  const onReconnect = useCallback(() => reconnect(), [reconnect]);
  const onLoadMore = useCallback(() => { loadMore(); }, [loadMore]);
  const onToggleVwap = useCallback(() => setShowVwap((v) => !v), []);
  const onToggleCvd = useCallback(() => setShowCvd((v) => !v), []);
  const onToggleCvdByPrice = useCallback(() => setShowCvdByPrice((v) => !v), []);
  const onCvdBinMode = useCallback((m: CvdBinMode) => setCvdBinMode(m), []);
  const onCvdBinManual = useCallback((n: number) => setCvdBinManual(n), []);
  const onBottomPanelHeightChange = useCallback(
    (h: number) => setBottomPanelHeight(h),
    [],
  );
  const onCvdStripScaleChange = useCallback(
    (s: number) => setCvdStripScale(s),
    [],
  );

  // Keyboard shortcut: Left arrow = load older history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        loadMore();
      } else if (e.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadMore]);

  return (
    <div className="h-full w-full flex flex-col bg-tv-bg text-tv-text">
      <Toolbar
        symbol={symbol}
        symbols={symbolList}
        onSymbol={onSymbol}
        interval={interval}
        onInterval={onInterval}
        status={status}
        source={source}
        lastUpdateAt={lastUpdateAt}
        messageCount={messageCount}
        pollCount={pollCount}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        onReconnect={onReconnect}
        showVwap={showVwap}
        showCvd={showCvd}
        showCvdByPrice={showCvdByPrice}
        onToggleVwap={onToggleVwap}
        onToggleCvd={onToggleCvd}
        onToggleCvdByPrice={onToggleCvdByPrice}
        cvdBinMode={cvdBinMode}
        cvdBinManual={cvdBinManual}
        cvdBinSize={cvdBinSize}
        onCvdBinMode={onCvdBinMode}
        onCvdBinManual={onCvdBinManual}
        tickSize={symbolInfo?.tickSize ?? 0.01}
        cvdStripScale={cvdStripScale}
        onCvdStripScaleChange={onCvdStripScaleChange}
      />

      <div className="flex-1 flex min-h-0">
        {/* Chart area */}
        <div className="flex-1 min-w-0 relative">
          {(loading || !symbolInfo) && (
            <div className="absolute inset-0 flex items-center justify-center text-tv-textDim z-20 pointer-events-none">
              {error ? `Error: ${error}` : loading ? 'Loading market data…' : 'Loading symbols…'}
            </div>
          )}
          <ChartView
            symbol={symbolInfo}
            candles={candles}
            lastPrice={lastPrice}
            latestVolume={latestVolume}
            maxMinByTime={maxMinByTime}
            showVwap={showVwap}
            showCvd={showCvd}
            showCvdByPrice={showCvdByPrice}
            cvdBinSize={cvdBinSize}
            bottomPanelHeight={bottomPanelHeight}
            onBottomPanelHeightChange={onBottomPanelHeightChange}
            cvdStripScale={cvdStripScale}
          />
        </div>

        {/* Right panel */}
        <aside className="w-[240px] border-l border-tv-border bg-tv-panel overflow-y-auto flex-shrink-0">
          <TickerInfo
            symbol={symbol}
            lastPrice={lastPrice}
            precision={symbolInfo?.pricePrecision ?? 2}
          />
          <OrderBookPanel
            symbol={symbol}
            precision={symbolInfo?.pricePrecision ?? 2}
          />
          <div className="p-3 text-[10px] text-tv-textDim leading-relaxed border-t border-tv-border">
            <div className="font-semibold text-tv-text mb-1">Chart</div>
            Live Binance USDT-M Futures candles via <span className="font-mono">@kline</span> stream.
            Order book updates every second. Volume histogram below the candles;
            per-candle delta (buy − sell) histogram at the very bottom.
          </div>
        </aside>
      </div>
    </div>
  );
}
