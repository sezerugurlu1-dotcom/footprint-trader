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
import { FavoritesList } from './components/FavoritesList';
import { SectionBoundary } from './components/SectionBoundary';
import { useBinanceData } from './hooks/useBinanceData';
import { useFootprintData } from './hooks/useFootprintData';
import { useExchangeInfo } from './hooks/useExchangeInfo';
import { useFavorites } from './hooks/useFavorites';
import type { Interval, SymbolInfo } from './types';
import type { CvdPeriod, VwapPeriod } from './utils/periodAnchors';

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
  // Renamed the setter to avoid shadowing the global setInterval timer
  // function.  A future maintainer writing `setInterval(cb, 1000)` inside
  // this component would otherwise silently call the React state setter
  // instead of scheduling a timer.
  const [interval, setIntervalState] = useState<Interval>('15m');

  // VWAP / CVD reset periods.  `session` matches the original
  // daily-reset behaviour for VWAP.  CVD defaults to daily reset.
  const [vwapPeriod, setVwapPeriod] = useState<VwapPeriod>('session');
  const [cvdPeriod, setCvdPeriod] = useState<CvdPeriod>('daily');

  // User's favourite pairs.  Persists to localStorage; defaults to
  // BTCUSDT on first run.  The ★ button in the top-left of the chart
  // and the right-side list both call `toggle(...)`.
  const { favorites, isFavorite, toggle: toggleFavorite } = useFavorites();
  const isCurrentFavorite = isFavorite(symbol);

  // Resizable bottom panel (DeltaStatsBar + DeltaTable).  The
  // user drags the handle above the panel to change this value;
  // 140px is a comfortable default that shows the four table
  // rows clearly.  Clamping happens in the VResizeHandle's
  // parent effect, not here.
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(140);

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

  // Stable setters for Toolbar.
  const onSymbol = useCallback((s: string) => setSymbol(s), []);
  const onInterval = useCallback((i: Interval) => setIntervalState(i), []);
  const onReconnect = useCallback(() => reconnect(), [reconnect]);
  const onLoadMore = useCallback(() => { loadMore(); }, [loadMore]);
  const onRefreshSymbols = useCallback(() => { void refreshExchangeInfo(); }, [refreshExchangeInfo]);
  const onBottomPanelHeightChange = useCallback(
    (h: number) => setBottomPanelHeight(h),
    [],
  );
  const onVwapPeriod = useCallback((p: VwapPeriod) => setVwapPeriod(p), []);
  const onCvdPeriod = useCallback((p: CvdPeriod) => setCvdPeriod(p), []);

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
        vwapPeriod={vwapPeriod}
        onVwapPeriod={onVwapPeriod}
        cvdPeriod={cvdPeriod}
        onCvdPeriod={onCvdPeriod}
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
              interval={interval}
              candles={candles}
              lastPrice={lastPrice}
              latestVolume={latestVolume}
              maxMinByTime={maxMinByTime}
              bottomPanelHeight={bottomPanelHeight}
              onBottomPanelHeightChange={onBottomPanelHeightChange}
              vwapPeriod={vwapPeriod}
              cvdPeriod={cvdPeriod}
              isFavorite={isCurrentFavorite}
              onToggleFavorite={() => toggleFavorite(symbol)}
            />
          </SectionBoundary>
        </div>

        {/* Right panel — hidden below md (768px) so the chart gets the
            full width on narrow viewports.  Ticker + favourites are
            nice-to-have, not critical for a functional chart. */}
        <aside className="w-[240px] border-l border-tv-border bg-tv-panel overflow-y-auto flex-shrink-0 hidden md:block">
          <SectionBoundary label="Ticker">
            <TickerInfo
              symbol={symbol}
              lastPrice={lastPrice}
              precision={symbolInfo?.pricePrecision ?? 2}
            />
          </SectionBoundary>
          <SectionBoundary label="Favorites">
            <FavoritesList
              favorites={[...favorites]}
              activeSymbol={symbol}
              onSelect={setSymbol}
              onToggle={toggleFavorite}
            />
          </SectionBoundary>
          <div className="p-3 text-[10px] text-tv-textDim leading-relaxed border-t border-tv-border">
            <div className="font-semibold text-tv-text mb-1">Chart</div>
            Live Binance USDT-M Futures candles via <span className="font-mono">@kline</span> stream.
            Tap the ★ next to a symbol's name to add it to the favorites list on
            the right.
          </div>
        </aside>
      </div>
    </div>
  );
}
