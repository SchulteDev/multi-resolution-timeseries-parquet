import { describe, it, expect } from 'vitest'
import { RES } from '../shared/time'
import { selectTier } from '../shared/tierSelect'
import { selectFiles, type TierInfo } from '../shared/manifest'

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
})

describe('selectFiles', () => {
  const tier: TierInfo = {
    res: '1min',
    bucketMs: RES['1min'],
    files: [
      { path: 'data/1min/2020-01.parquet', start: 0, end: 100, rows: 101 },
      { path: 'data/1min/2020-02.parquet', start: 101, end: 200, rows: 100 },
      { path: 'data/1min/2020-03.parquet', start: 201, end: 300, rows: 100 },
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
})
