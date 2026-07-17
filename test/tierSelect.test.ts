import { describe, it, expect } from 'vitest'
import { RES } from '../shared/time'
import { selectTier } from '../shared/tierSelect'
import { selectFiles, rowRange, type FileInfo, type TierInfo } from '../shared/manifest'

const DAY = RES['1d']

describe('selectTier', () => {
  it('uses 1min for short spans', () => {
    expect(selectTier(2 * RES['1h']).res).toBe('1min') // 2 hours -> 120 buckets
  })

  it('steps up to coarser tiers as the span grows', () => {
    expect(selectTier(3 * DAY).res).toBe('15min') // 288 buckets at 15min
    expect(selectTier(60 * DAY).res).toBe('1h') // ~1440 buckets at 1h
    expect(selectTier(5 * 365 * DAY).res).toBe('1d') // full range -> daily
  })

  it('never exceeds the point cap except when fully zoomed out', () => {
    const maxPoints = 3000
    for (const days of [1, 7, 30, 120, 365, 5 * 365]) {
      const choice = selectTier(days * DAY, maxPoints)
      const isCoarsest = choice.res === '1d'
      if (!isCoarsest) expect(choice.estPoints).toBeLessThanOrEqual(maxPoints)
    }
  })

  it('falls back to the coarsest tier when even it exceeds the cap', () => {
    // Tiny cap forces the post-loop fallback branch; estPoints reflects 1d.
    const choice = selectTier(30 * DAY, 5)
    expect(choice.res).toBe('1d')
    expect(choice.estPoints).toBeCloseTo(30, 5)
  })
})

describe('selectFiles', () => {
  const tier: TierInfo = {
    res: '1min',
    bucketMs: RES['1min'],
    files: [
      { path: 'data/1min/2020-01.parquet', start: 0, end: 100, rows: 101, bytes: 1000, footerBytes: 200 },
      { path: 'data/1min/2020-02.parquet', start: 101, end: 200, rows: 100, bytes: 1000, footerBytes: 200 },
      { path: 'data/1min/2020-03.parquet', start: 201, end: 300, rows: 100, bytes: 1000, footerBytes: 200 },
    ],
  }

  it('returns only files overlapping the range', () => {
    const files = selectFiles(tier, 150, 250)
    expect(files.map((f) => f.path)).toEqual([
      'data/1min/2020-02.parquet',
      'data/1min/2020-03.parquet',
    ])
  })

  it('includes a file when the range touches its boundary', () => {
    expect(selectFiles(tier, 100, 100).map((f) => f.path)).toEqual(['data/1min/2020-01.parquet'])
  })

  it('returns [] for a range before, after, or in a gap between files', () => {
    const gappy: TierInfo = {
      res: '1min',
      bucketMs: RES['1min'],
      files: [
        { path: 'a.parquet', start: 0, end: 100, rows: 101, bytes: 1, footerBytes: 1 },
        { path: 'b.parquet', start: 200, end: 300, rows: 101, bytes: 1, footerBytes: 1 },
      ],
    }
    expect(selectFiles(gappy, -50, -10)).toEqual([]) // before all
    expect(selectFiles(gappy, 400, 500)).toEqual([]) // after all
    expect(selectFiles(gappy, 120, 180)).toEqual([]) // in the gap
  })
})

describe('rowRange', () => {
  // 1-min file: 100 rows, row i covers ts = 1000 + i*60000.
  const file: FileInfo = { path: 'f', start: 1000, end: 1000 + 99 * 60_000, rows: 100, bytes: 1, footerBytes: 1 }
  const bucket = RES['1min']

  it('maps a time window to an inclusive/exclusive row range', () => {
    // rows 10..20 (t1 lands in bucket 20 -> exclusive rowEnd 21)
    const r = rowRange(file, bucket, 1000 + 10 * 60_000, 1000 + 20 * 60_000)
    expect(r).toEqual({ rowStart: 10, rowEnd: 21 })
  })

  it('clamps to [0, rows] when the window overhangs the file', () => {
    const r = rowRange(file, bucket, 1000 - 5 * 60_000, 1000 + 500 * 60_000)
    expect(r).toEqual({ rowStart: 0, rowEnd: 100 })
  })

  it('returns null for a non-overlapping window', () => {
    expect(rowRange(file, bucket, 1000 + 500 * 60_000, 1000 + 600 * 60_000)).toBeNull()
  })
})
