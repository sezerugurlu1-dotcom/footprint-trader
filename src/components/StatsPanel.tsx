// Aggregate footprint stats for the last N visible candles.
// P2 #12: subscribes to the builder via useSyncExternalStore so the panel
// re-renders only when builder data actually changes, not on a 500ms timer.

import { useEffect, useState } from 'react';
import type { FootprintCandle } from '../types';
import type { FootprintBuilder } from '../utils/footprint';
import { formatVolume } from '../utils/format';

interface Props {
  builder: FootprintBuilder | null;
  showFootprint: boolean;
  lastN?: number;
}

interface Stats {
  totalBid: number;
  totalAsk: number;
  delta: number;
  cvd: number;            // cumulative delta
  maxImbalance: { price: number; side: 'bid' | 'ask'; ratio: number } | null;
  buyPct: number;
  candleCount: number;
}

function computeStats(candles: FootprintCandle[]): Stats {
  let totalBid = 0, totalAsk = 0, cvd = 0;
  let maxImbalance: Stats['maxImbalance'] = null;
  for (const c of candles) {
    totalBid += c.totalBid;
    totalAsk += c.totalAsk;
    cvd += c.delta;
    for (const l of c.levels) {
      if (l.bidVol > 0 && l.askVol > 0) {
        const r = l.bidVol > l.askVol
          ? { price: l.price, side: 'bid' as const, ratio: l.bidVol / l.askVol }
          : { price: l.price, side: 'ask' as const, ratio: l.askVol / l.bidVol };
        if (!maxImbalance || r.ratio > maxImbalance.ratio) maxImbalance = r;
      }
    }
  }
  const total = totalBid + totalAsk;
  const buyPct = total > 0 ? (totalBid / total) * 100 : 50;
  return { totalBid, totalAsk, delta: totalBid - totalAsk, cvd, maxImbalance, buyPct, candleCount: candles.length };
}

// Cheap "did the builder change?" fingerprint: aggregate over the last `lastN`
// candles. Cached on the builder so we don't recompute on every render.
function fingerprint(builder: FootprintBuilder, lastN: number): string {
  const all = builder.build();
  if (!all.length) return 'empty';
  const slice = all.slice(-lastN);
  let h = 0;
  for (const c of slice) {
    h = ((h * 31 + c.time) | 0);
    h = ((h * 31 + c.totalBid) | 0);
    h = ((h * 31 + c.totalAsk) | 0);
    h = ((h * 31 + c.levels.length) | 0);
  }
  return `${slice.length}:${h}`;
}

export function StatsPanel({ builder, showFootprint, lastN = 20 }: Props) {
  // Recompute when the fingerprint changes, or once a second as a fallback
  // for in-place mutations the builder may make without invalidating identity.
  const [stats, setStats] = useState<Stats | null>(null);
  const [fingerprintStr, setFingerprint] = useState<string>('');

  useEffect(() => {
    if (!builder || !showFootprint) { setStats(null); return; }
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const fp = fingerprint(builder, lastN);
      if (fp !== fingerprintStr) {
        setFingerprint(fp);
        const all = builder.build();
        setStats(computeStats(all.slice(-lastN)));
      }
    };

    tick();
    // Light fallback timer for cases the builder mutates without timestamp drift.
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [builder, showFootprint, lastN, fingerprintStr]);

  if (!showFootprint) {
    return (
      <div className="p-3 text-xs text-tv-textDim">
        Enable the footprint overlay to see per-candle order flow stats.
      </div>
    );
  }
  if (!stats) return <div className="p-3 text-xs text-tv-textDim">Aggregating trades…</div>;

  const deltaColor = stats.delta >= 0 ? 'text-tv-green' : 'text-tv-red';
  const cvdColor   = stats.cvd   >= 0 ? 'text-tv-green' : 'text-tv-red';
  const buyWidth = `${Math.max(2, Math.min(98, stats.buyPct))}%`;

  return (
    <div className="p-3 text-xs space-y-2">
      <div className="text-tv-textDim text-[10px] uppercase tracking-wider">
        Order Flow · last {stats.candleCount} candles
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-tv-panel2 rounded p-2">
          <div className="text-tv-textDim text-[10px]">Buy Vol (taker)</div>
          <div className="text-tv-green font-mono">{formatVolume(stats.totalBid)}</div>
        </div>
        <div className="bg-tv-panel2 rounded p-2">
          <div className="text-tv-textDim text-[10px]">Sell Vol (taker)</div>
          <div className="text-tv-red font-mono">{formatVolume(stats.totalAsk)}</div>
        </div>
      </div>

      <div className="bg-tv-panel2 rounded p-2">
        <div className="flex items-center justify-between text-[10px] text-tv-textDim">
          <span>Buy / Sell</span>
          <span className="font-mono">{stats.buyPct.toFixed(1)}% / {(100 - stats.buyPct).toFixed(1)}%</span>
        </div>
        <div className="h-1.5 mt-1 rounded overflow-hidden bg-tv-red/40">
          <div className="h-full bg-tv-green" style={{ width: buyWidth }} />
        </div>
      </div>

      <div className="bg-tv-panel2 rounded p-2">
        <div className="text-tv-textDim text-[10px]">Delta (Buy − Sell)</div>
        <div className={`font-mono text-lg ${deltaColor}`}>
          {stats.delta >= 0 ? '+' : ''}{formatVolume(stats.delta)}
        </div>
      </div>

      <div className="bg-tv-panel2 rounded p-2">
        <div className="text-tv-textDim text-[10px]">Cumulative Delta (CVD)</div>
        <div className={`font-mono text-lg ${cvdColor}`}>
          {stats.cvd >= 0 ? '+' : ''}{formatVolume(stats.cvd)}
        </div>
      </div>

      {stats.maxImbalance && (
        <div className="bg-tv-panel2 rounded p-2">
          <div className="text-tv-textDim text-[10px]">Top Imbalance</div>
          <div className="font-mono flex items-center justify-between">
            <span className={stats.maxImbalance.side === 'bid' ? 'text-tv-green' : 'text-tv-red'}>
              {stats.maxImbalance.side === 'bid' ? 'BUY' : 'SELL'} @ {stats.maxImbalance.price}
            </span>
            <span className="text-tv-text">{stats.maxImbalance.ratio.toFixed(1)}×</span>
          </div>
        </div>
      )}
    </div>
  );
}
