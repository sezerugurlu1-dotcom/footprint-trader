# Footprint Trader

A browser-based, TradingView-style **Binance USDT-M Futures** chart with
candles, volume, and order-flow overlays (VWAP, CVD, CVD-by-Price).
Built on top of [`lightweight-charts`](https://github.com/tradingview/lightweight-charts).

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
- **Three toggleable indicators**:
  - **VWAP** (amber) on the main price scale
  - **CVD** (cumulative delta) on its own bottom strip
  - **CVD-by-Price** (redesign) histogram with five bin-size presets
    (Auto / Fine / Medium / Coarse / Manual) and a resizable strip
- **Right panel**: 24h ticker summary + top-10 order-book ladder
  (100 ms updates from `@depth10@100ms`)
- **Per-candle delta** bar (Vol · Δ · Δ Max · Δ Min) + Footprint
  Summary table at the bottom of the chart
- **Resizable bottom panel** (60 – 480 px)
- **Load-more** older history via toolbar button or **←** arrow key
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
│   ├── useOrderBook.ts            order book + ticker
│   ├── useExchangeInfo.ts         cached symbol list (NEW)
│   ├── useVwap.ts                 VWAP line
│   ├── useCvd.ts                  time-based CVD line
│   └── useCvdByPrice.ts           redesigned price-binned CVD
│
├── utils/                         pure, tested logic
│   ├── footprint.ts               FootprintBuilder (per-level agg)
│   ├── cvd.ts, cvdByPrice.ts, vwap.ts
│   ├── cvdByPrice.types.ts        CvdBinMode + multiplier constants
│   ├── format.ts, timeFormat.ts
│   └── *.test.ts                  77 unit tests
│
├── components/
│   ├── ChartView.tsx              chart + all overlays + resizable panel
│   ├── ChartLegend.tsx            OHLCV HUD following the crosshair
│   ├── Toolbar.tsx                symbol/interval/indicators/bin/scale
│   ├── TickerInfo.tsx             24h stats in the right panel
│   ├── OrderBookPanel.tsx         10-level ladder
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
2. **Order book + ticker** — `useOrderBook` opens `@depth10@100ms` and
   `@ticker` WS streams directly.
3. **Per-level data** — `useFootprintData` opens `@trade` (we used
   `@aggTrade` first but it stopped delivering payloads on USDT-M
   around 2026-08) and backfills ~50 k recent trades via
   `fetchRecentAggTrades`, which walks **backward from "now"** because
   Binance rejects `aggTrades` windows wider than 2 days.

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
npm test            # 77 unit tests (vitest)
npm run build       # type-check + production build
npx tsc -b --noEmit # type-check only
```

CI runs on push to `main` and on PRs: type-check → build → test.  See
`.github/workflows/ci.yml`.

### Adding a new indicator

1. Build the pure logic in `src/utils/` (test it with a `.test.ts`).
2. Wrap it in a hook in `src/hooks/`.
3. Wire it into `ChartView.tsx` (a new `ISeriesApi` on a dedicated
   price scale is the usual pattern) and into `Toolbar.tsx` (a toggle
   button + any size controls).

## License

Personal project.  No warranty.  Not investment advice.
