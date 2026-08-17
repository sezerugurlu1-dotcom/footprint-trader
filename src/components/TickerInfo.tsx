// Ticker info via WS @ticker stream (P3 #21) with a REST fallback for the
// first paint. 1s update cadence beats the previous 5s REST polling.

import { useEffect, useState } from 'react';
import { fetch24hTicker } from '../binance/api';
import { TickerStream } from '../binance/ws';
import { formatPrice, formatVolume } from '../utils/format';

interface Props { symbol: string; lastPrice: number | null; precision?: number; }

interface T24 {
  lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string;
  volume: string; quoteVolume: string; openPrice: string;
}

export function TickerInfo({ symbol, lastPrice, precision = 2 }: Props) {
  const [t, setT] = useState<T24 | null>(null);

  useEffect(() => {
    let alive = true;
    let stream: TickerStream | null = null;

    // Initial REST so the panel is non-empty on first paint.
    (async () => {
      try {
        const j = await fetch24hTicker(symbol);
        if (alive) setT(j);
      } catch { /* ignored — WS will fill in */ }
    })();

    stream = new TickerStream(symbol);
    stream.on((m) => {
      if (!alive) return;
      setT({
        lastPrice: m.c,
        priceChangePercent: m.P,
        highPrice: m.h,
        lowPrice: m.l,
        volume: m.v,
        quoteVolume: m.q,
        openPrice: m.o,
      });
    });
    stream.connect();

    return () => {
      alive = false;
      stream?.close();
    };
  }, [symbol]);

  const change = t ? Number(t.priceChangePercent) : 0;
  const color = change >= 0 ? 'text-tv-green' : 'text-tv-red';
  const sign = change >= 0 ? '+' : '';

  return (
    <div className="p-3 border-b border-tv-border">
      <div className="flex items-baseline gap-3">
        <div className="text-lg font-semibold">{symbol}</div>
        <div className={`text-2xl font-mono ${color}`}>
          {formatPrice(lastPrice ?? (t ? Number(t.lastPrice) : NaN), precision)}
        </div>
        <div className={`text-sm font-mono ${color}`}>
          {sign}{change.toFixed(2)}%
        </div>
      </div>

      {t && (
        <div className="grid grid-cols-2 gap-y-1 gap-x-4 mt-3 text-xs text-tv-textDim">
          <Stat label="24h High"   value={formatPrice(Number(t.highPrice), precision)} />
          <Stat label="24h Low"    value={formatPrice(Number(t.lowPrice), precision)} />
          <Stat label="24h Open"   value={formatPrice(Number(t.openPrice), precision)} />
          <Stat label="24h Volume" value={formatVolume(Number(t.volume)) + ` ${symbol.replace('USDT', '')}`} />
          <Stat label="24h Quote"  value={'$' + formatVolume(Number(t.quoteVolume))} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="text-tv-textDim">{label}</div>
      <div className="text-right font-mono text-tv-text">{value}</div>
    </>
  );
}
