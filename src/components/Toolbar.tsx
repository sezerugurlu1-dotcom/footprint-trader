import type { Interval } from '../types';
import { INTERVALS } from '../types';
import type { LiveStatus, LiveSource } from '../hooks/useBinanceData';
import type { CvdBinMode } from '../utils/cvdByPrice.types';

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

  // Indicator visibility
  showVwap: boolean;
  showCvd: boolean;
  showCvdByPrice: boolean;
  onToggleVwap: () => void;
  onToggleCvd: () => void;
  onToggleCvdByPrice: () => void;

  // CVD-by-Price bin size
  cvdBinMode: CvdBinMode;
  cvdBinManual: number;
  cvdBinSize: number;
  onCvdBinMode: (m: CvdBinMode) => void;
  onCvdBinManual: (n: number) => void;
  tickSize: number;

  // CVD strip height.  1.0 = original (8% CVD line + 12% CVD-by-Price
  // = 20% of chart height).  The user drags the slider to make the
  // strips smaller or larger.
  cvdStripScale: number;
  onCvdStripScaleChange: (s: number) => void;
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
  showVwap, showCvd, showCvdByPrice,
  onToggleVwap, onToggleCvd, onToggleCvdByPrice,
  cvdBinMode, cvdBinManual, cvdBinSize, onCvdBinMode, onCvdBinManual,
  tickSize,
  cvdStripScale, onCvdStripScaleChange,
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

      {/* Indicator toggles.  Each button shows the series colour
          swatch and the active state with the same accent the
          interval buttons use.  The redesigned CVD-by-Price is the
          one this toolbar was extended for; the older CVD line and
          VWAP are kept so the user can build the view they want. */}
      <div
        role="group"
        aria-label="Chart indicators"
        className="flex items-center bg-tv-panel2 border border-tv-border rounded overflow-hidden"
      >
        <IndicatorToggle
          label="VWAP"
          color="#fbbf24"
          active={showVwap}
          onClick={onToggleVwap}
          title="Show / hide VWAP line"
        />
        <IndicatorToggle
          label="CVD"
          color="#60a5fa"
          active={showCvd}
          onClick={onToggleCvd}
          title="Show / hide cumulative-delta line"
        />
        <IndicatorToggle
          label="Δ Price"
          color="#26a69a"
          active={showCvdByPrice}
          onClick={onToggleCvdByPrice}
          title="Show / hide CVD-by-Price histogram (redesigned)"
        />
      </div>

      {/* CVD-by-Price bin-size selector.  Only rendered when the
          histogram is visible, so the toolbar doesn't carry a
          control for a hidden indicator. */}
      {showCvdByPrice && (
        <div className="flex items-center gap-1.5 text-xs text-tv-textDim">
          <label htmlFor="cvd-bin-mode" className="sr-only">CVD-by-Price bin size</label>
          <select
            id="cvd-bin-mode"
            value={cvdBinMode}
            onChange={(e) => onCvdBinMode(e.target.value as CvdBinMode)}
            className="bg-tv-panel2 border border-tv-border rounded px-2 py-1 hover:border-tv-accent focus:outline-none focus:border-tv-accent"
            title="CVD-by-Price bin size preset"
          >
            <option value="auto">Auto bin</option>
            <option value="fine">Fine (auto × 0.25)</option>
            <option value="medium">Medium (auto)</option>
            <option value="coarse">Coarse (auto × 4)</option>
            <option value="manual">Manual…</option>
          </select>
          {cvdBinMode === 'manual' ? (
            <input
              type="number"
              min={tickSize}
              step={tickSize}
              value={cvdBinManual}
              onChange={(e) => onCvdBinManual(Number(e.target.value))}
              className="w-20 bg-tv-panel2 border border-tv-border rounded px-2 py-1 font-mono text-xs focus:outline-none focus:border-tv-accent"
              title="Manual bin size in price units (multiples of tick)"
            />
          ) : (
            <span
              className="font-mono text-[11px] text-tv-textDim/80 px-1"
              title="Current effective bin size in price units"
            >
              = {cvdBinSize.toPrecision(3)}
            </span>
          )}
        </div>
      )}

      {/* CVD-strip height slider.  Always visible (it controls the
          layout of the chart, not just the histogram), so the user
          can pre-size the strips before turning the indicator on. */}
      <div className="flex items-center gap-1.5 text-xs text-tv-textDim">
        <label htmlFor="cvd-strip-scale" className="whitespace-nowrap">
          CVD strip
        </label>
        <input
          id="cvd-strip-scale"
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={cvdStripScale}
          onChange={(e) => onCvdStripScaleChange(Number(e.target.value))}
          className="w-20 accent-tv-accent cursor-pointer"
          title="Make the CVD strips smaller or larger (0.5× – 2×)"
        />
        <span
          className="font-mono text-[11px] text-tv-textDim/80 w-9 text-right"
          title="Current scale factor"
        >
          {cvdStripScale.toFixed(1)}×
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3 text-tv-textDim text-xs">
        <span>Binance USDT-M Futures</span>
      </div>
    </div>
  );
}

/**
 * Single indicator toggle button used by the indicator group.
 * Renders a colour swatch + label, with the same active-state
 * treatment as the interval buttons.  The colour swatch goes dim
 * when the indicator is hidden so the toolbar still hints at what
 * each button represents.
 */
function IndicatorToggle({
  label,
  color,
  active,
  onClick,
  title,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={
        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-r border-tv-border last:border-r-0 ' +
        (active
          ? 'bg-tv-accent text-white'
          : 'text-tv-textDim hover:text-tv-text hover:bg-[#22263a]')
      }
    >
      <span
        aria-hidden="true"
        className="inline-block w-2.5 h-2.5 rounded-sm"
        style={{ background: color, opacity: active ? 1 : 0.45 }}
      />
      {label}
    </button>
  );
}
