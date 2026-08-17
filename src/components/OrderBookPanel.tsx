import { useOrderBook } from '../hooks/useOrderBook';
import { formatPrice, formatVolume } from '../utils/format';

interface Props { symbol: string | null; precision?: number; }

export function OrderBookPanel({ symbol, precision = 2 }: Props) {
  const book = useOrderBook(symbol, 10);

  if (!book) {
    return <div className="p-3 text-xs text-tv-textDim">Loading order book…</div>;
  }

  const maxQty = Math.max(
    ...book.bids.slice(0, 12).map((b) => b.qty),
    ...book.asks.slice(0, 12).map((a) => a.qty),
    0,
  );

  return (
    <div className="text-xs font-mono">
      <div className="px-3 py-2 border-b border-tv-border text-tv-textDim text-[10px] uppercase tracking-wider">
        Order Book · {symbol}
      </div>
      <div>
        <div className="grid grid-cols-2 px-3 py-1 text-[10px] text-tv-textDim">
          <div>Price</div><div className="text-right">Size</div>
        </div>
        {/* Asks - reverse so highest price is at top, lowest at bottom near spread */}
        {[...book.asks.slice(0, 10)].reverse().map((a, i) => (
          <div key={`a${i}`} className="relative grid grid-cols-2 px-3 py-[2px]">
            {/* P3 #14: bar grows from the right edge so the size label never gets covered */}
            <div className="absolute right-0 top-0 bottom-0 bg-tv-red/15"
                 style={{ width: `${(a.qty / maxQty) * 100}%` }} />
            <div className="relative text-tv-red">{formatPrice(a.price, precision)}</div>
            <div className="relative text-right text-tv-text">{formatVolume(a.qty)}</div>
          </div>
        ))}

        <div className="px-3 py-1.5 my-1 bg-tv-panel2 border-y border-tv-border text-tv-text">
          <Spread book={book} precision={precision} />
        </div>

        {book.bids.slice(0, 10).map((b, i) => (
          <div key={`b${i}`} className="relative grid grid-cols-2 px-3 py-[2px]">
            <div className="absolute right-0 top-0 bottom-0 bg-tv-green/15"
                 style={{ width: `${(b.qty / maxQty) * 100}%` }} />
            <div className="relative text-tv-green">{formatPrice(b.price, precision)}</div>
            <div className="relative text-right text-tv-text">{formatVolume(b.qty)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Spread({ book, precision }: { book: { bids: { price: number }[]; asks: { price: number }[] }; precision: number }) {
  if (!book.bids.length || !book.asks.length) return <span className="text-tv-textDim">—</span>;
  const bestBid = book.bids[0].price;
  const bestAsk = book.asks[0].price;
  const spread  = bestAsk - bestBid;
  const pct     = (spread / bestAsk) * 100;
  // P3 #22: use the symbol's price precision for the spread label.
  const decimals = Math.min(8, Math.max(0, precision + 1));
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-tv-textDim">Spread</span>
      <span>{spread.toFixed(decimals)} ({pct.toFixed(3)}%)</span>
    </div>
  );
}
