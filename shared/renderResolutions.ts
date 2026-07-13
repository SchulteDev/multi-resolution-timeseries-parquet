import { RES, type Resolution } from './time'
import { selectTier } from './tierSelect'

// A resolution the chart can *render*, which may or may not have a stored tier.
// Derived resolutions (2min/5min from 1min, 4h from 1h) have no Parquet tier of
// their own — the frontend reads the nearest finer stored tier and resamples
// them in-browser with the same `rollup()` used to build the stored tiers. This
// demonstrates that not every resolution needs a precomputed tier.
export interface RenderResolution {
  key: string
  label: string
  bucketMs: number
  sourceRes: Resolution // stored tier to read from (itself when stored)
  derived: boolean // true => resampled client-side from sourceRes
}

const MIN = 60_000

export const RENDER_RESOLUTIONS: RenderResolution[] = [
  { key: '1min', label: '1 min', bucketMs: RES['1min'], sourceRes: '1min', derived: false },
  { key: '2min', label: '2 min', bucketMs: 2 * MIN, sourceRes: '1min', derived: true },
  { key: '5min', label: '5 min', bucketMs: 5 * MIN, sourceRes: '1min', derived: true },
  { key: '15min', label: '15 min', bucketMs: RES['15min'], sourceRes: '15min', derived: false },
  { key: '1h', label: '1 hour', bucketMs: RES['1h'], sourceRes: '1h', derived: false },
  { key: '4h', label: '4 hours', bucketMs: 4 * RES['1h'], sourceRes: '1h', derived: true },
  { key: '1d', label: '1 day', bucketMs: RES['1d'], sourceRes: '1d', derived: false },
]

export const RENDER_BY_KEY: Record<string, RenderResolution> = Object.fromEntries(
  RENDER_RESOLUTIONS.map((r) => [r.key, r]),
)

export interface RenderPlan {
  render: RenderResolution // what actually gets drawn (may differ from requested if downgraded)
  requested: RenderResolution // what the user asked for
  requestedSourceRows: number // rows the requested resolution would need to read
  downgraded: boolean // requested was too wide to resample; fell back to auto tier
  t0: number // padded, clamped fetch bounds
  t1: number
  sourceRowsNeeded: number // rows the chosen render will actually read
}

/**
 * Decide what to render for a visible window.
 *
 * - `mode === 'auto'`: zoom-driven stored-tier selection (the efficient path).
 * - explicit key: render that resolution, reading its source tier. If serving
 *   it would require reading more than `maxSourceRows` from the source (e.g.
 *   "2min over 5 years" = the whole 1-min tier), fall back to the auto stored
 *   tier and flag `downgraded` — this is exactly where a precomputed tier earns
 *   its place.
 */
export function resolveRender(
  mode: string,
  minMs: number,
  maxMs: number,
  globalStart: number,
  globalEnd: number,
  margin: number,
  maxSourceRows: number,
): RenderPlan {
  const span = maxMs - minMs
  const pad = span * margin
  const t0 = Math.max(globalStart, minMs - pad)
  const t1 = Math.min(globalEnd, maxMs + pad)

  const autoKey = selectTier(span).res
  const requested = mode === 'auto' ? RENDER_BY_KEY[autoKey] : (RENDER_BY_KEY[mode] ?? RENDER_BY_KEY[autoKey])
  const requestedSourceRows = (t1 - t0) / RES[requested.sourceRes]

  let render = requested
  let downgraded = false
  if (mode !== 'auto' && requestedSourceRows > maxSourceRows) {
    render = RENDER_BY_KEY[autoKey]
    downgraded = true
  }

  return {
    render,
    requested,
    requestedSourceRows,
    downgraded,
    t0,
    t1,
    sourceRowsNeeded: (t1 - t0) / RES[render.sourceRes],
  }
}
