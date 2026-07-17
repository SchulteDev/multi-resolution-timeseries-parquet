import { selectFiles, type Manifest } from '../shared/manifest'
import { rollup, type Series } from '../shared/ohlc'
import { bucketStart, type Resolution } from '../shared/time'
import { resolveRender, type RenderResolution } from '../shared/renderResolutions'
import { loadRange } from './dataLoader'

// ---------------------------------------------------------------------------
// The whole "query engine". There is no database and no SQL: a query is
// answered by (1) picking the resolution tier, (2) turning the time window into
// a row range by arithmetic, (3) letting Parquet's footer stats skip the
// row groups outside it, (4) reading only the requested columns over HTTP range
// requests, and (5) optionally resampling in-browser for a resolution that has
// no stored tier.
// ---------------------------------------------------------------------------

// Fraction of the visible span pre-fetched on each side, so panning within the
// margin costs no new request.
const MARGIN = 0.5

// Cap on rows read from a source tier for an explicitly-chosen resolution.
// Beyond this, a derived resolution isn't worth resampling client-side — that's
// where a precomputed tier earns its place — so we fall back to auto tiering.
const MAX_SOURCE_ROWS = 20_000

export interface QuerySpec {
  from: number // epoch ms, inclusive
  to: number // epoch ms, inclusive
  resolution: string // 'auto' | a render-resolution key ('5min', '4h', …)
  columns: string[] // projection, e.g. ['ts','close']
}

/** What actually happened — the execution plan we show in the UI. */
export interface QueryPlan {
  from: number
  to: number
  columns: string[]
  columnsTotal: number

  resolution: RenderResolution // what got drawn
  sourceRes: Resolution // the stored tier that was read
  derived: boolean // was it resampled client-side?

  // Set when the requested resolution was too wide to serve and we fell back.
  downgradedFrom?: RenderResolution
  downgradedRows?: number

  filePath: string
  fileBytes: number
  rowGroupsTotal: number
  rowGroupsRead: number
  firstRowGroup: number
  lastRowGroup: number

  rowsRead: number // source rows read from Parquet
  bars: number // bars actually drawn (differs when resampled)
  bytesFetched: number
  requests: number
}

/**
 * Answer a query for a time window at a resolution, reading only what's needed.
 *
 * Returns the OHLC series to draw plus the plan describing how it was served.
 */
export async function query(
  manifest: Manifest,
  spec: QuerySpec,
): Promise<{ series: Series; plan: QueryPlan }> {
  // 1. Which resolution can we serve, and from which stored tier?
  const r = resolveRender(
    spec.resolution,
    spec.from,
    spec.to,
    manifest.globalStart,
    manifest.globalEnd,
    MARGIN,
    MAX_SOURCE_ROWS,
  )
  const tier = manifest.tiers.find((t) => t.res === r.render.sourceRes)
  if (!tier) throw new Error(`Manifest has no '${r.render.sourceRes}' tier for '${r.render.key}'`)

  // 2. Time window -> read window. For a derived resolution, widen to whole
  //    render-buckets so the edge bars are built from complete source rows.
  let readFrom = r.t0
  let readTo = r.t1
  if (r.render.derived) {
    readFrom = bucketStart(r.t0, r.render.bucketMs)
    readTo = bucketStart(r.t1, r.render.bucketMs) + r.render.bucketMs
  }

  // 3-4. Read: row-group skipping + column projection over HTTP range requests.
  const files = selectFiles(tier, readFrom, readTo)
  const base = await loadRange(tier, readFrom, readTo, spec.columns, files)

  // 5. Resample if this resolution has no stored tier — same rollup() that
  //    builds the tiers on the write path, just running in the browser.
  const series: Series = r.render.derived ? rollup(base, r.render.bucketMs) : base

  const file = files[0]
  return {
    series,
    plan: {
      from: spec.from,
      to: spec.to,
      columns: spec.columns,
      columnsTotal: 5, // ts + OHLC
      resolution: r.render,
      sourceRes: r.render.sourceRes,
      derived: r.render.derived,
      downgradedFrom: r.downgraded ? r.requested : undefined,
      downgradedRows: r.downgraded ? r.requestedSourceRows : undefined,
      filePath: file?.path ?? '—',
      fileBytes: file?.bytes ?? 0,
      rowGroupsTotal: base.rowGroupsTotal,
      rowGroupsRead: base.rowGroupsRead,
      firstRowGroup: base.firstRowGroup,
      lastRowGroup: base.lastRowGroup,
      rowsRead: base.rowsLoaded,
      bars: series.ts.length,
      bytesFetched: base.bytesFetched,
      requests: base.requests,
    },
  }
}

/** The window a plan actually loaded — used to decide when a reload is needed. */
export function planWindow(manifest: Manifest, spec: QuerySpec) {
  const r = resolveRender(
    spec.resolution,
    spec.from,
    spec.to,
    manifest.globalStart,
    manifest.globalEnd,
    MARGIN,
    MAX_SOURCE_ROWS,
  )
  let readFrom = r.t0
  let readTo = r.t1
  if (r.render.derived) {
    readFrom = bucketStart(r.t0, r.render.bucketMs)
    readTo = bucketStart(r.t1, r.render.bucketMs) + r.render.bucketMs
  }
  return { readFrom, readTo, renderKey: r.render.key, sourceRes: r.render.sourceRes }
}
