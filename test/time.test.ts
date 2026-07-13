import { describe, it, expect } from 'vitest'
import { RES, RESOLUTIONS, bucketStart } from '../shared/time'

describe('time buckets', () => {
  it('floors to the bucket boundary', () => {
    expect(bucketStart(0, RES['1min'])).toBe(0)
    expect(bucketStart(59_999, RES['1min'])).toBe(0)
    expect(bucketStart(60_000, RES['1min'])).toBe(60_000)
    expect(bucketStart(60_001, RES['1min'])).toBe(60_000)
  })

  it('day buckets align to UTC midnight', () => {
    const noon = Date.UTC(2021, 5, 15, 12, 30, 0)
    expect(bucketStart(noon, RES['1d'])).toBe(Date.UTC(2021, 5, 15))
  })

  it('each coarser tier is an exact multiple of the next finer one', () => {
    for (let i = 1; i < RESOLUTIONS.length; i++) {
      const finer = RES[RESOLUTIONS[i - 1]]
      const coarser = RES[RESOLUTIONS[i]]
      expect(coarser % finer).toBe(0)
    }
  })
})
