// Lean chart shell: toolbar, candlestick + volume chart, ticker, order book.
// Footprint / per-level order flow is intentionally NOT rendered in this
// build.  The per-level utility (FootprintBuilder in src/utils/footprint.ts)
// is still wired up via useFootprintData — it feeds the per-candle delta
// stats and the max/min rows of the bottom table.  The standalone
// FootprintOverlay component was removed in the P2 cleanup; the source
// is preserved in git history (see commits prior to <hash>) if a
// follow-up session wants to re-mount it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { ChartView } from './components/ChartView';
import { TickerInfo } from './components/TickerInfo';
import { OrderBookPanel } from './components/OrderBookPanel';
import { SectionBoundary } from './components/SectionBoundary';
import { useBinanceData } from './hooks/useBinanceData';
import { useFootprintData } from './hooks/useFootprintData';
import { useExchangeInfo } from './hooks/useExchangeInfo';
import { useCvdBinSize } from './hooks/useCvdBinSize';
import type { Interval, SymbolInfo } from './types';
import type { CvdBinMode } from './utils/cvdByPrice.types';

const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT',
  'ARBUSDT', 'OPUSDT', 'APTUSDT', 'SUIUSDT', 'TONUSDT',
];

export default function App() {
  const {
    data: exchangeInfo,
    loading: exchangeInfoLoading,
    refresh: refreshExchangeInfo,
  } = useExchangeInfo();
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

  // CVD-by-Price bin size.  Owns the resolution from preset (auto /
  // fine / medium / coarse / manual) to a concrete price-bin number;
  // see useCvdBinSize for the formula.
  const cvdBinSize = useCvdBinSize({
    mode: cvdBinMode,
    manual: cvdBinManual,
    symbolInfo,
    candles,
  });

  // Stable setters for Toolbar.
  const onSymbol = useCallback((s: string) => setSymbol(s), []);
  const onInterval = useCallback((i: Interval) => setInterval(i), []);
  const onReconnect = useCallback(() => reconnect(), [reconnect]);
  const onLoadMore = useCallback(() => { loadMore(); }, [loadMore]);
  const onRefreshSymbols = useCallback(() => { void refreshExchangeInfo(); }, [refreshExchangeInfo]);
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
        refreshingSymbols={exchangeInfoLoading}
        onRefreshSymbols={onRefreshSymbols}
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
        {/* Chart area — min-w-[320px] prevents the flex layout from
            collapsing the chart to 0×0 on very narrow viewports (the
            lightweight-charts library then has no size to render into). */}
        <div className="flex-1 min-w-[320px] relative">
          {(loading || !symbolInfo) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-tv-textDim z-20 pointer-events-none gap-2">
              {error ? (
                <>
                  <div className="text-tv-red text-sm">Error: {error}</div>
                  {/418|teapot/i.test(error) && (
                    <div className="text-xs text-tv-textDim text-center max-w-md">
                      Binance is blocking the request from this IP (HTTP 418).
                      Use <span className="font-mono text-tv-text">↻ Symbols</span> to retry,
                      or pick a different network.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={onReconnect}
                    className="pointer-events-auto mt-2 px-3 py-1 text-xs text-tv-textDim hover:text-tv-text border border-tv-border rounded"
                  >
                    ↻ Retry
                  </button>
                </>
              ) : (
                <div>{loading ? 'Loading market data…' : 'Loading symbols…'}</div>
              )}
            </div>
          )}
          <SectionBoundary label="Chart" onRetry={onReconnect}>
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
          </SectionBoundary>
        </div>

        {/* Right panel — hidden below md (768px) so the chart gets the
            full width on narrow viewports.  Ticker / order book are
            nice-to-have, not critical for a functional chart. */}
        <aside className="w-[240px] border-l border-tv-border bg-tv-panel overflow-y-auto flex-shrink-0 hidden md:block">
          <SectionBoundary label="Ticker">
            <TickerInfo
              symbol={symbol}
              lastPrice={lastPrice}
              precision={symbolInfo?.pricePrecision ?? 2}
            />
          </SectionBoundary>
          <SectionBoundary label="Order book">
            <OrderBookPanel
              symbol={symbol}
              precision={symbolInfo?.pricePrecision ?? 2}
            />
          </SectionBoundary>
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
