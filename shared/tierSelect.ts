import { RES, RESOLUTIONS, type Resolution } from './time'

export interface TierChoice {
  res: Resolution
  bucketMs: number
  estPoints: number
}

/**
 * Pick the tier for a visible time span by holding points-on-screen roughly
 * constant. Returns the finest resolution whose estimated bucket count stays at
 * or below `maxPoints`; falls back to the coarsest tier when even that exceeds
 * the cap (fully zoomed out).
 *
 * With maxPoints ~3000 this yields: ~1min up to ~2 days visible, ~15min up to
 * ~1 month, ~1h up to ~4 months, ~1d beyond.
 */
export function selectTier(spanMs: number, maxPoints = 3000): TierChoice {
  for (const res of RESOLUTIONS) {
    const bucketMs = RES[res]
    const estPoints = spanMs / bucketMs
    if (estPoints <= maxPoints) return { res, bucketMs, estPoints }
  }
  const res = RESOLUTIONS[RESOLUTIONS.length - 1]
  return { res, bucketMs: RES[res], estPoints: spanMs / RES[res] }
}
