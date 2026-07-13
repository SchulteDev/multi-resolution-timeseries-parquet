import { describe, it, expect } from 'vitest'
import { RES } from '../shared/time'
import { rollup, type Series } from '../shared/ohlc'
import { generateMinuteSeries } from '../scripts/lib/synth'

describe('rollup', () => {
  it('computes OHLC as first/max/min/last within a bucket', () => {
    // Three 1-min bars inside a single 15-min bucket.
    const src: Series = {
      ts: [0, 60_000, 120_000],
      open: [10, 12, 11],
      high: [13, 15, 12],
      low: [9, 11, 8],
      close: [12, 11, 10],
    }
    const out = rollup(src, RES['15min'])
    expect(out.ts).toEqual([0])
    expect(out.open).toEqual([10]) // first open
    expect(out.high).toEqual([15]) // max high
    expect(out.low).toEqual([8]) // min low
    expect(out.close).toEqual([10]) // last close
  })

  it('splits into separate buckets on boundary crossings', () => {
    const src: Series = {
      ts: [0, 60_000, 900_000], // third bar is in the next 15-min bucket
      open: [10, 12, 20],
      high: [13, 15, 22],
      low: [9, 11, 19],
      close: [12, 11, 21],
    }
    const out = rollup(src, RES['15min'])
    expect(out.ts).toEqual([0, 900_000])
    expect(out.open).toEqual([10, 20])
    expect(out.close).toEqual([11, 21])
  })

  it('OHLC composes: cascaded tiers equal a direct rollup of the raw data', () => {
    // The core correctness property behind building tiers by cascade.
    const minute = generateMinuteSeries({ startMs: Date.UTC(2020, 0, 1), count: 5_000, seed: 7 })

    const cascaded = rollup(rollup(rollup(minute, RES['15min']), RES['1h']), RES['1d'])
    const direct = rollup(minute, RES['1d'])

    expect(cascaded).toEqual(direct)
  })
})
