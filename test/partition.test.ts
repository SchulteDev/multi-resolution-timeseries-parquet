import { describe, it, expect } from 'vitest'
import { RES } from '../shared/time'
import { emptySeries, type Series } from '../shared/ohlc'
import { partitionByMonth } from '../scripts/lib/partition'

// Build a 1-min series of `count` bars starting at `startMs` (values are
// placeholders — partitioning only cares about ts).
function minuteSeries(startMs: number, count: number): Series {
  const s = emptySeries()
  for (let i = 0; i < count; i++) {
    const ts = startMs + i * RES['1min']
    s.ts.push(ts)
    s.open.push(i)
    s.high.push(i)
    s.low.push(i)
    s.close.push(i)
  }
  return s
}

describe('partitionByMonth', () => {
  it('splits on the exact UTC month boundary', () => {
    // Last minute of Jan through first minutes of Feb.
    const start = Date.UTC(2020, 0, 31, 23, 58)
    const parts = partitionByMonth(minuteSeries(start, 4)) // 23:58, 23:59, 00:00, 00:01
    expect(parts.map((p) => p.key)).toEqual(['2020-01', '2020-02'])
    expect(parts[0].series.ts.length).toBe(2) // 23:58, 23:59
    expect(parts[1].series.ts.length).toBe(2) // 00:00, 00:01
    expect(parts[1].start).toBe(Date.UTC(2020, 1, 1)) // Feb bucket starts at the boundary
  })

  it('sets each partition start/end from its first/last bar', () => {
    const start = Date.UTC(2020, 2, 1)
    const parts = partitionByMonth(minuteSeries(start, 90))
    for (const p of parts) {
      expect(p.start).toBe(p.series.ts[0])
      expect(p.end).toBe(p.series.ts[p.series.ts.length - 1])
    }
  })

  it('keeps a single-month series as one partition', () => {
    const parts = partitionByMonth(minuteSeries(Date.UTC(2021, 5, 10), 500))
    expect(parts).toHaveLength(1)
    expect(parts[0].key).toBe('2021-06')
    expect(parts[0].series.ts.length).toBe(500)
  })

  it('returns no partitions for an empty series', () => {
    expect(partitionByMonth(emptySeries())).toEqual([])
  })

  it('covers every input row exactly once across partitions', () => {
    const total = 60 * 24 * 70 // ~70 days, crosses 2-3 months
    const parts = partitionByMonth(minuteSeries(Date.UTC(2020, 0, 20), total))
    expect(parts.reduce((n, p) => n + p.series.ts.length, 0)).toBe(total)
  })
})
