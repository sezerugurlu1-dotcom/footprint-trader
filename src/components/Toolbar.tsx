import type { Interval } from '../types';
import { INTERVALS } from '../types';
import type { LiveStatus, LiveSource } from '../hooks/useBinanceData';
import type { CvdPeriod, VwapPeriod } from '../utils/periodAnchors';

const VWAP_PERIODS: { value: VwapPeriod; label: string }[] = [
  { value: 'session', label: 'Session' },
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const CVD_PERIODS: { value: CvdPeriod; label: string }[] = [
  { value: 'daily',  label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

interface Props {
  symbol: string;
  symbols: string[];
  onSymbol: (s: string) => void;
  interval: Interval;
  onInterval: (i: Interval) => void;
  status: LiveStatus;
  source: LiveSource;
  lastUpdateAt: number | null;
  messageCount: number;
  pollCount: number;
  loadingMore: boolean;
  onLoadMore: () => void;
  onReconnect: () => void;

  /** True while the exchangeInfo is being (re-)fetched. */
  refreshingSymbols: boolean;
  /** Force-fetch the symbol list from Binance. */
  onRefreshSymbols: () => void;

  /** VWAP reset period. */
  vwapPeriod: VwapPeriod;
  onVwapPeriod: (p: VwapPeriod) => void;
  /** CVD reset period. */
  cvdPeriod: CvdPeriod;
  onCvdPeriod: (p: CvdPeriod) => void;
}

const STATUS_COLOR: Record<LiveStatus, string> = {
  live: '#26a69a',
  stale: '#f5a623',
  offline: '#ef5350',
  connecting: '#787b86',
};

const STATUS_LABEL: Record<LiveStatus, string> = {
  live: 'live',
  stale: 'stale',
  offline: 'offline',
  connecting: 'connecting…',
};

const SOURCE_LABEL: Record<LiveSource, string> = {
  ws: 'WS',
  poll: 'REST',
  none: '—',
};

export function Toolbar({
  symbol, symbols, onSymbol, interval, onInterval,
  status, source, lastUpdateAt, messageCount, pollCount, loadingMore, onLoadMore, onReconnect,
  refreshingSymbols, onRefreshSymbols,
  vwapPeriod, onVwapPeriod, cvdPeriod, onCvdPeriod,
}: Props) {
  const ageSec = lastUpdateAt ? Math.max(0, Math.floor((Date.now() - lastUpdateAt) / 1000)) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-tv-panel border-b border-tv-border text-tv-text text-sm select-none min-h-[3rem]">
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span
          aria-hidden="true"
          className="w-2 h-2 rounded-full"
          style={{ background: STATUS_COLOR[status] }}
        />
        <span className="text-tv-textDim">{STATUS_LABEL[status]}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          source === 'ws' ? 'bg-tv-accent/20 text-tv-accent'
            : source === 'poll' ? 'bg-tv-panel2 text-tv-textDim'
            : 'text-tv-textDim/50'
        }`}>
          via {SOURCE_LABEL[source]}
        </span>
        {ageSec != null && status === 'live' && (
          <span className="text-tv-textDim/60 text-[10px]">· {ageSec}s ago</span>
        )}
        {source === 'ws' && messageCount > 0 && (
          <span className="text-tv-textDim/40 text-[10px]">· {messageCount} ws</span>
        )}
        {source === 'poll' && pollCount > 0 && (
          <span className="text-tv-textDim/40 text-[10px]">· {pollCount} polls</span>
        )}
      </div>

      <div className="h-6 w-px bg-tv-border mx-1" />

      <button
        type="button"
        onClick={onReconnect}
        title="Reconnect to Binance"
        className="px-2 py-1 text-xs text-tv-textDim hover:text-tv-text hover:bg-tv-panel2 rounded border border-tv-border"
      >
        ↻ Reconnect
      </button>

      <button
        type="button"
        onClick={onRefreshSymbols}
        disabled={refreshingSymbols}
        title="Refresh the symbol list from Binance"
        className={
          'px-2 py-1 text-xs rounded border ' +
          (refreshingSymbols
            ? 'border-tv-border text-tv-textDim/50 cursor-wait'
            : 'border-tv-border text-tv-textDim hover:text-tv-text hover:bg-tv-panel2')
        }
      >
        {refreshingSymbols ? '… Symbols' : '↻ Symbols'}
      </button>

      <div className="h-6 w-px bg-tv-border mx-1" />

      <div className="relative">
        <label className="sr-only" htmlFor="symbol-select">Symbol</label>
        <select
          id="symbol-select"
          aria-label="Symbol"
          value={symbol}
          onChange={(e) => onSymbol(e.target.value)}
          className="appearance-none bg-tv-panel2 border border-tv-border rounded px-3 py-1.5 pr-7 hover:border-tv-accent focus:outline-none focus:border-tv-accent"
        >
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-tv-textDim text-xs">▾</span>
      </div>

      <div role="group" aria-label="Interval" className="flex items-center bg-tv-panel2 border border-tv-border rounded overflow-hidden">
        {INTERVALS.map((i) => (
          <button
            key={i.value}
            type="button"
            aria-label={`Interval ${i.label}`}
            aria-pressed={interval === i.value}
            onClick={() => onInterval(i.value)}
            className={
              'px-2.5 py-1.5 text-xs ' +
              (interval === i.value
                ? 'bg-tv-accent text-white'
                : 'text-tv-textDim hover:text-tv-text hover:bg-[#22263a]')
            }
          >
            {i.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-tv-border mx-1" />

      <button
        type="button"
        onClick={onLoadMore}
        disabled={loadingMore}
        title="Load older candles (←)"
        className={
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border ' +
          (loadingMore
            ? 'border-tv-border text-tv-textDim/50 cursor-wait'
            : 'border-tv-border text-tv-textDim hover:text-tv-text hover:bg-tv-panel2')
        }
      >
        <span aria-hidden="true">←</span>
        <span>{loadingMore ? 'Loading…' : 'Load more'}</span>
        <kbd className="hidden md:inline px-1 ml-1 text-[10px] border border-tv-border rounded text-tv-textDim/70">←</kbd>
      </button>

      <div className="h-6 w-px bg-tv-border mx-1" />

      <div role="group" aria-label="VWAP period" className="flex items-center bg-tv-panel2 border border-tv-border rounded overflow-hidden">
        <span className="px-2 text-[10px] uppercase tracking-wider text-tv-textDim/70">VWAP</span>
        {VWAP_PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-label={`VWAP period ${p.label}`}
            aria-pressed={vwapPeriod === p.value}
            onClick={() => onVwapPeriod(p.value)}
            className={
              'px-2.5 py-1.5 text-xs ' +
              (vwapPeriod === p.value
                ? 'bg-tv-accent text-white'
                : 'text-tv-textDim hover:text-tv-text hover:bg-[#22263a]')
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      <div role="group" aria-label="CVD period" className="flex items-center bg-tv-panel2 border border-tv-border rounded overflow-hidden">
        <span className="px-2 text-[10px] uppercase tracking-wider text-tv-textDim/70">CVD</span>
        {CVD_PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-label={`CVD period ${p.label}`}
            aria-pressed={cvdPeriod === p.value}
            onClick={() => onCvdPeriod(p.value)}
            className={
              'px-2.5 py-1.5 text-xs ' +
              (cvdPeriod === p.value
                ? 'bg-tv-accent text-white'
                : 'text-tv-textDim hover:text-tv-text hover:bg-[#22263a]')
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3 text-tv-textDim text-xs">
        <span>Binance USDT-M Futures</span>
      </div>
    </div>
  );
}
