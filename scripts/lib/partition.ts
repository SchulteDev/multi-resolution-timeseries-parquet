import { sliceSeries, type Series } from '../../shared/ohlc'

export interface Partition {
  key: string // e.g. "2020-01"
  series: Series
  start: number
  end: number
}

// UTC year-month key for a timestamp, e.g. "2020-03".
function monthKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Split a timestamp-ascending series into contiguous monthly partitions.
 * Only the 1-min tier is partitioned; keeping each file small keeps its footer
 * small, so the reader pays a tiny fixed cost before row-group skipping.
 */
export function partitionByMonth(series: Series): Partition[] {
  const parts: Partition[] = []
  let startIdx = 0
  let curKey = series.ts.length ? monthKey(series.ts[0]) : ''

  const flush = (endIdx: number) => {
    const sub = sliceSeries(series, startIdx, endIdx)
    parts.push({
      key: curKey,
      series: sub,
      start: sub.ts[0],
      end: sub.ts[sub.ts.length - 1],
    })
  }

  for (let i = 1; i < series.ts.length; i++) {
    const k = monthKey(series.ts[i])
    if (k !== curKey) {
      flush(i)
      startIdx = i
      curKey = k
    }
  }
  if (series.ts.length) flush(series.ts.length)
  return parts
}
