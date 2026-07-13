import { describe, it, expect } from 'vitest'
import { generateMinuteSeries } from '../scripts/lib/synth'

describe('synthetic generator', () => {
  it('is deterministic for a given seed', () => {
    const opts = { startMs: 0, count: 1000, seed: 123 }
    const a = generateMinuteSeries(opts)
    const b = generateMinuteSeries(opts)
    expect(a).toEqual(b)
  })

  it('produces 1-minute spaced, ascending timestamps', () => {
    const s = generateMinuteSeries({ startMs: 1000, count: 100, seed: 1 })
    expect(s.ts[0]).toBe(1000)
    expect(s.ts[1] - s.ts[0]).toBe(60_000)
    for (let i = 1; i < s.ts.length; i++) expect(s.ts[i]).toBeGreaterThan(s.ts[i - 1])
  })

  it('respects OHLC invariants on every bar', () => {
    const s = generateMinuteSeries({ startMs: 0, count: 2000, seed: 99 })
    for (let i = 0; i < s.ts.length; i++) {
      expect(s.high[i]).toBeGreaterThanOrEqual(Math.max(s.open[i], s.close[i]))
      expect(s.low[i]).toBeLessThanOrEqual(Math.min(s.open[i], s.close[i]))
      expect(s.high[i]).toBeGreaterThanOrEqual(s.low[i])
      expect(s.close[i]).toBeGreaterThan(0)
    }
  })
})
