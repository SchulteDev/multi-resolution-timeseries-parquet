import { RES } from '../../shared/time'
import type { Series } from '../../shared/ohlc'

// Small, fast, seedable PRNG (mulberry32). Deterministic output keeps CI builds
// and the demo reproducible.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface GenerateOptions {
  startMs: number
  count: number // number of 1-minute bars to produce
  seed?: number
  startPrice?: number
  vol?: number // per micro-tick volatility (fraction of price)
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Generate a synthetic 24/7 1-minute OHLC series via a seeded geometric random
 * walk. Each minute samples a handful of micro-ticks so high/low are genuine
 * intrabar extremes (not just max/min of open/close). A slow sinusoidal drift
 * adds multi-year swings so the zoomed-out tiers show visible structure.
 */
export function generateMinuteSeries(opts: GenerateOptions): Series {
  const { startMs, count, seed = 42, startPrice = 100, vol = 0.0009 } = opts
  const rand = mulberry32(seed)

  // Standard normal via Box-Muller.
  const gauss = () => {
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  const ts = new Array<number>(count)
  const open = new Array<number>(count)
  const high = new Array<number>(count)
  const low = new Array<number>(count)
  const close = new Array<number>(count)

  const micro = 5
  // ~6 slow swings across the whole span for visible long-term structure.
  const swingPeriod = count / 6
  let price = startPrice

  for (let i = 0; i < count; i++) {
    const drift = 0.0000012 * Math.sin((2 * Math.PI * i) / swingPeriod)
    const o = price
    let hi = price
    let lo = price
    for (let m = 0; m < micro; m++) {
      price *= 1 + drift + vol * gauss()
      if (price > hi) hi = price
      if (price < lo) lo = price
    }
    ts[i] = startMs + i * RES['1min']
    open[i] = round2(o)
    high[i] = round2(hi)
    low[i] = round2(lo)
    close[i] = round2(price)
  }

  return { ts, open, high, low, close }
}
