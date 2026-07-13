import { bucketStart } from './time'

// Column-oriented OHLC series. Column-oriented (not row-of-objects) because
// that is how Parquet stores it and how hyparquet returns projected columns.
export interface Series {
  ts: number[] // epoch ms, ascending, one per bucket
  open: number[]
  high: number[]
  low: number[]
  close: number[]
}

export function emptySeries(): Series {
  return { ts: [], open: [], high: [], low: [], close: [] }
}

export function seriesLength(s: Series): number {
  return s.ts.length
}

/**
 * Roll a finer, timestamp-ascending OHLC series up into coarser buckets.
 *
 * OHLC is a monoid: open = first, close = last, high = max, low = min all
 * compose across bucket merges. That is why coarser tiers can be built by
 * cascading (1min -> 15min -> 1h -> 1d) instead of re-scanning the raw 1-min
 * data for every tier, and why the result is identical to rolling up the raw
 * data directly. (A plain mean would NOT compose without carrying counts.)
 *
 * Assumes `src.ts` is sorted ascending and `dstBucketMs` is a multiple of the
 * source resolution so buckets nest cleanly.
 */
export function rollup(src: Series, dstBucketMs: number): Series {
  const out = emptySeries()
  let curKey = Number.NaN
  for (let i = 0; i < src.ts.length; i++) {
    const key = bucketStart(src.ts[i], dstBucketMs)
    if (key !== curKey) {
      out.ts.push(key)
      out.open.push(src.open[i])
      out.high.push(src.high[i])
      out.low.push(src.low[i])
      out.close.push(src.close[i])
      curKey = key
    } else {
      const j = out.ts.length - 1
      if (src.high[i] > out.high[j]) out.high[j] = src.high[i]
      if (src.low[i] < out.low[j]) out.low[j] = src.low[i]
      out.close[j] = src.close[i]
    }
  }
  return out
}

// Extract a contiguous slice [start, end) of a series (used to split the 1-min
// tier into monthly partition files).
export function sliceSeries(s: Series, start: number, end: number): Series {
  return {
    ts: s.ts.slice(start, end),
    open: s.open.slice(start, end),
    high: s.high.slice(start, end),
    low: s.low.slice(start, end),
    close: s.close.slice(start, end),
  }
}
