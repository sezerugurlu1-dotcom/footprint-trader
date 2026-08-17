// Domain types for the chart

export type Interval =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

export const INTERVALS: { value: Interval; label: string; seconds: number }[] = [
  { value: '1m',  label: '1m',  seconds: 60 },
  { value: '3m',  label: '3m',  seconds: 180 },
  { value: '5m',  label: '5m',  seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '30m', label: '30m', seconds: 1800 },
  { value: '1h',  label: '1h',  seconds: 3600 },
  { value: '2h',  label: '2h',  seconds: 7200 },
  { value: '4h',  label: '4h',  seconds: 14400 },
  { value: '1d',  label: '1d',  seconds: 86400 },
];

export interface Candle {
  time: number;   // unix seconds (lightweight-charts convention)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;       // total base-asset volume (e.g. BTC)
  /** Taker BUY base-asset volume from the kline response (field 9 of
   *  the REST response, `V` on the @kline WebSocket frame).  The
   *  taker SELL volume is `volume - takerBuyVolume`; the candle's
   *  delta is `2 * takerBuyVolume - volume` (positive = net buy
   *  pressure, negative = net sell pressure).  Always present when
   *  the candle comes from Binance, but defaulted to 0 for safety. */
  takerBuyVolume: number;
}

export interface AggTrade {
  id: number;
  price: number;
  qty: number;
  ts: number;     // ms
  isBuyerMaker: boolean; // true => aggressive SELL, false => aggressive BUY
}

export interface FootprintLevel {
  price: number;
  bidVol: number;   // taker buy (aggressive buy volume)
  askVol: number;   // taker sell (aggressive sell volume)
}

export interface FootprintCandle {
  time: number;     // candle open (unix seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  levels: FootprintLevel[];
  totalBid: number;
  totalAsk: number;
  delta: number;     // bid - ask
  maxVol: number;    // max( bid+ask ) across levels - used for width scaling
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;  // min price step
}
