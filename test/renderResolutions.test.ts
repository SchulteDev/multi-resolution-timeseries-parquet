import { describe, it, expect } from 'vitest'
import { RES } from '../shared/time'
import { selectTier } from '../shared/tierSelect'
import { rollup, type Series } from '../shared/ohlc'
import { generateMinuteSeries } from '../scripts/lib/synth'
import { RENDER_RESOLUTIONS, RENDER_BY_KEY, resolveRender } from '../shared/renderResolutions'

const DAY = RES['1d']
const gStart = Date.UTC(2020, 0, 1)
const gEnd = Date.UTC(2025, 0, 1)
const MARGIN = 0.5
const MAX_SOURCE_ROWS = 20_000

function plan(mode: string, spanDays: number, atDay = 100) {
  const min = gStart + atDay * DAY
  return resolveRender(mode, min, min + spanDays * DAY, gStart, gEnd, MARGIN, MAX_SOURCE_ROWS)
}

describe('render resolution ladder', () => {
  it('derived resolutions are exact multiples of their source bucket (nest cleanly)', () => {
    for (const r of RENDER_RESOLUTIONS) {
      if (r.derived) expect(r.bucketMs % RES[r.sourceRes]).toBe(0)
    }
  })

  it('2min/5min derive from 1min, 4h derives from 1h', () => {
    expect(RENDER_BY_KEY['2min'].sourceRes).toBe('1min')
    expect(RENDER_BY_KEY['5min'].sourceRes).toBe('1min')
    expect(RENDER_BY_KEY['4h'].sourceRes).toBe('1h')
  })
})

describe('resolveRender', () => {
  it('auto picks a stored tier and never downgrades', () => {
    const p = plan('auto', 3)
    expect(p.render.derived).toBe(false)
    expect(p.downgraded).toBe(false)
  })

  it('serves a derived resolution when the source read is bounded', () => {
    const p = plan('5min', 3) // 3 days at 1min ~= 4320 rows, well under budget
    expect(p.render.key).toBe('5min')
    expect(p.render.derived).toBe(true)
    expect(p.downgraded).toBe(false)
  })

  it('serves 4h from 1h over a several-month window', () => {
    const p = plan('4h', 120) // 120 days of 1h ~= 2880 rows
    expect(p.render.key).toBe('4h')
    expect(p.downgraded).toBe(false)
  })

  it('downgrades a derived resolution that is too wide to resample', () => {
    const p = plan('5min', 5 * 365) // 5min over 5y => the whole 1-min tier
    expect(p.downgraded).toBe(true)
    expect(p.requested.key).toBe('5min')
    expect(p.render.derived).toBe(false) // fell back to a stored tier
    expect(p.requestedSourceRows).toBeGreaterThan(MAX_SOURCE_ROWS)
  })

  it('downgrades even a stored resolution when its source read is too wide', () => {
    const p = plan('1min', 5 * 365) // forcing 1min over 5y would read millions of rows
    expect(p.downgraded).toBe(true)
    expect(p.render.key).not.toBe('1min')
  })

  it('falls back to the auto tier for an unknown mode key', () => {
    const p = plan('bogus-3min', 3)
    expect(p.downgraded).toBe(false) // unknown resolves via the auto path, not a downgrade
    expect(p.render.derived).toBe(false)
    expect(p.render.key).toBe(selectTier(3 * DAY).res)
  })

  it('clamps the padded fetch window to the global bounds', () => {
    // Window flush against globalStart: t0 must not pad below it.
    const p = resolveRender('auto', gStart, gStart + 4 * DAY, gStart, gEnd, MARGIN, MAX_SOURCE_ROWS)
    expect(p.t0).toBe(gStart)
    expect(p.t1).toBeLessThanOrEqual(gEnd)
  })
})

describe('client-side resampling correctness', () => {
  it('resampling 1min -> 2min/5min produces correctly bucketed OHLC', () => {
    const minute = generateMinuteSeries({ startMs: gStart, count: 5_000, seed: 3 })
    for (const key of ['2min', '5min']) {
      const r = RENDER_BY_KEY[key]
      const factor = r.bucketMs / RES['1min'] // bars merged per output bucket
      const out = rollup(minute, r.bucketMs)

      // one output bar per `factor` input bars (input aligned to bucket start)
      expect(out.ts.length).toBe(Math.ceil(minute.ts.length / factor))
      // buckets are epoch-aligned
      expect(out.ts.every((t) => t % r.bucketMs === 0)).toBe(true)
      // first output bucket = first/max/min/last of its constituent input bars
      const n = Math.min(factor, minute.ts.length)
      expect(out.open[0]).toBe(minute.open[0])
      expect(out.close[0]).toBe(minute.close[n - 1])
      expect(out.high[0]).toBe(Math.max(...minute.high.slice(0, n)))
      expect(out.low[0]).toBe(Math.min(...minute.low.slice(0, n)))
    }
  })

  it('4h derived from the 1h tier equals 4h rolled directly from 1min (OHLC composes)', () => {
    const minute = generateMinuteSeries({ startMs: gStart, count: 20_000, seed: 8 })
    const hourly: Series = rollup(minute, RES['1h'])
    const fourHourFromHourly = rollup(hourly, RENDER_BY_KEY['4h'].bucketMs)
    const fourHourFromMinute = rollup(minute, RENDER_BY_KEY['4h'].bucketMs)
    expect(fourHourFromHourly).toEqual(fourHourFromMinute)
  })
})
