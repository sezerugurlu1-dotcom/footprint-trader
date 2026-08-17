# Browser Smoke Test Guide

> This file is the manual test list for a running instance of the app
> (`npm run dev`). The agent's browser tool was stuck at a 639 px viewport
> during development, so some checks need to be done on a real monitor.

## 1. Start the dev server

```powershell
cd "C:\Users\SEZER\.minimax-agent\projects\footprint-trader"
npm run dev
```

Vite should listen on port `5173`. Open `http://localhost:5173` in a browser.

## 2. Expected first-load sequence

| Seconds | Behaviour | Expected |
|---|---|---|
| 0 | "Loading market data…" overlay | Visible |
| 1-2 | "live" badge (green) | WS connected |
| 2-3 | First candles appear on the chart | Visible |
| 3-5 | Order book populates | 10 ask + 10 bid levels |
| 5+ | `takerBuyVolume` from the kline stream feeds the per-candle delta bar | Stats bar updates |

> The per-level footprint overlay and the divergence markers that earlier
> versions of this doc referenced are not part of the current build. The
> footprint source is preserved in `src/components/FootprintOverlay.tsx`
> for a follow-up session, but it is not mounted by `App.tsx`.

## 3. Manual test list

- [ ] **Chart candles render** at >800 px chart width
- [ ] **Symbol switch** (BTCUSDT → ETHUSDT): chart, order book, ticker, stats refresh within ~1 s
- [ ] **Interval switch** (1m → 1h): candles redraw
- [ ] **Mouse wheel zoom** works on the chart
- [ ] **Window resize**: chart auto-resizes
- [ ] **Indicator toggles** (VWAP, CVD, Δ Price) hide/show the corresponding series
- [ ] **CVD-by-Price bin-size dropdown** (Auto / Fine / Medium / Coarse / Manual) re-bins the histogram
- [ ] **CVD-strip scale slider** (0.5× – 2×) resizes the CVD strips
- [ ] **← arrow** key loads older candles; **Esc** blurs any focused input
- [ ] **No console errors** in DevTools → Console

## 4. If the chart looks empty

Open DevTools (F12) and check the Console for first-load errors.

If the chart only fails at the test agent's narrow 639 px viewport:
- Try a wider window (1280×800 or bigger)
- Or DevTools → Device Toolbar (Ctrl+Shift+M) → Responsive → 1920×1080

If the chart fails at normal viewport sizes too, check the console for:
1. `[lightweight-charts]` warnings
2. `ResizeObserver loop completed with undelivered notifications` (cycle warning)
3. `Uncaught (in promise)` errors

## 5. Known test-environment limits

- The agent's browser tool could not render candles at 639 px (likely a
  `lightweight-charts` initial 0×0 layout issue that does not occur at
  normal viewports).
- All other components (symbol, interval, indicator toggles, order book,
  ticker, stats bar, keyboard shortcuts) were verified.
