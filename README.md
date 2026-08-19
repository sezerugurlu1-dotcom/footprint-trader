# Footprint Trader

A browser-based, TradingView-style **Binance USDT-M Futures** chart with
candles, volume, and live order-flow overlays (VWAP + slope-colored
CVD). Built on top of
[`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5
with a multi-pane layout (price + indicator).

> ⚠️ **Research / educational use only.** This is not investment
> software. It streams public market data from Binance and renders a
> chart — it does not place orders, manage positions, or hold keys.

## Quick start

```powershell
git clone <this-repo>
cd footprint-trader
npm install
npm run dev
```

Vite serves on `http://localhost:5173` by default.

For a production build:

```powershell
npm run build       # type-check + bundle into dist/
npm run preview     # serve the built bundle
```

## What you get

- **Candlestick + volume chart** for any Binance USDT-M Futures pair
  (1m → 1M intervals), with the official TV dark-theme palette.
- **Live dual-source updates**: WebSocket (`@kline`) for sub-second
  ticks, REST polling every 3 s as a fallback when WS is blocked
  (common in some regions / behind certain firewalls).  A 30 s
  watchdog force-reconnects a stuck stream.
- **Two toggleable overlays**, each with a period selector
  (session / daily / weekly / monthly for VWAP; daily / weekly for CVD):
  - **VWAP** (amber) on the main price scale
  - **CVD** (cumulative delta) on its own bottom pane, slope-colored
    (green where delta is rising, red where it is falling)
- **Favorites list** in the right panel — pin symbols to the top with
  a single click, persisted in `localStorage`, BTCUSDT seeded by
  default. ★ toggle in the chart's top-left corner.
- **24h ticker** summary next to the favorites list
- **Per-candle delta** bar (Vol · Δ · Δ Max · Δ Min) + delta table
  at the bottom of the chart
- **Resizable bottom panel** (60 – 480 px)
- **Symbol refresh** button (↻ Symbols) re-fetches the exchange-info
  symbol list; cached in `sessionStorage` for 24 h

## Architecture

```
src/
├── App.tsx                        top-level state (symbol, interval,
│                                  indicator visibility, panel sizes)
├── main.tsx                       React root + ErrorBoundary
│
├── binance/                       raw API + WS layer
│   ├── api.ts                     fetchKlines, fetchExchangeInfo,
│   │                              fetchRecentAggTrades
│   └── ws.ts                      KlineStream, AggTradeStream,
│                                  DepthStream, TickerStream
│
├── hooks/                         React glue around the data layer
│   ├── useBinanceData.ts          candles + dual-source + watchdog
│   ├── useFootprintData.ts        per-level delta + backfill
│   ├── useExchangeInfo.ts         cached symbol list
│   ├── useFavorites.ts            favorites list (localStorage)
│   ├── useVwap.ts                 VWAP line with period anchor
│   └── useCvd.ts                  CVD line with period anchor
│
├── utils/                         pure, tested logic
│   ├── footprint.ts               FootprintBuilder (per-level agg)
│   ├── cvd.ts                     splitCvdBySlope (slope-color helper)
│   ├── vwap.ts                    VWAP accumulator
│   ├── periodAnchors.ts           session/daily/weekly/monthly anchors
│   ├── format.ts, timeFormat.ts
│   └── *.test.ts                  unit tests
│
├── components/
│   ├── ChartView.tsx              multi-pane chart (candles + CVD)
│   ├── ChartLegend.tsx            OHLCV HUD + ★ favorite toggle
│   ├── Toolbar.tsx                symbol / interval / period selectors
│   ├── TickerInfo.tsx             24h stats in the right panel
│   ├── FavoritesList.tsx          pinned symbols (replaces order book)
│   ├── DeltaStatsBar.tsx          Vol · Δ · Δ Max · Δ Min
│   ├── DeltaTable.tsx             per-candle summary
│   ├── VResizeHandle.tsx          drag handle for the bottom panel
│   ├── ErrorBoundary.tsx
│   └── FootprintOverlay.tsx       intentionally disabled — see below
```

### Data flow

1. **Candles** — `useBinanceData` does an initial 500-kline REST load,
   then opens a `@kline` WS plus a 3 s REST poll (so a WS block doesn't
   stop the chart).  A 30 s watchdog force-reconnects a stuck stream.
2. **Ticker** — `useTicker` opens a `@ticker` WS stream and feeds the
   24h stats panel next to the favorites list.
3. **Per-level data** — `useFootprintData` opens `@trade` (we used
   `@aggTrade` first but it stopped delivering payloads on USDT-M
   around 2026-08) and backfills ~50 k recent trades via
   `fetchRecentAggTrades`, which walks **backward from "now"** because
   Binance rejects `aggTrades` windows wider than 2 days.
4. **Favorites** — `useFavorites` reads / writes a JSON list in
   `localStorage` under `footprint-trader.favorites.v1`. The active
   symbol is pinned to the top of the list with a ► indicator.

## Test-environment caveat

Binance blocks the **USDT-M Futures** endpoints from some IPs with
`418 I'm a teapot`.  Spot endpoints are not blocked.  The app's symbol
list comes from the futures endpoint, so the chart works but the
right-panel symbol picker falls back to a hard-coded list of 15
popular pairs until you click **↻ Symbols** to retry.

The `exchangeInfo` response is now cached in `sessionStorage` for 24 h
to avoid the 418-on-every-reload loop.

## Disabled features (source preserved, not mounted)

These live in the repo for a follow-up session but are not currently
shown in the UI:

- **`src/components/FootprintOverlay.tsx`** — full per-candle /
  per-price-level footprint chart (POC, imbalance, volume profile).
  `App.tsx` keeps the file in the tree on purpose.
- **Delta Divergence markers** — a follow-up idea, not yet implemented.
- **The custom `src/components/StatsPanel.tsx`** was removed in the
  P0 cleanup because it was unimported.

## Development

```powershell
npm run dev         # vite dev server with HMR
npm test            # unit tests (vitest)
npm run build       # type-check + production build
npx tsc -b --noEmit # type-check only
```

CI runs on push to `main` and on PRs: type-check → build → test.  See
`.github/workflows/ci.yml`.

### Adding a new indicator

1. Build the pure logic in `src/utils/` (test it with a `.test.ts`).
2. Wrap it in a hook in `src/hooks/`.
3. Wire it into `ChartView.tsx` — either a new `ISeriesApi` on the
   existing price scale or a brand-new pane via `chart.addPane()`. Add
   a toggle button + any size controls in `Toolbar.tsx`.

## License

Personal project.  No warranty.  Not investment advice.
