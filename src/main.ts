import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import './style.css'
import { loadManifest } from './manifest'
import { selectFiles, type Manifest } from '../shared/manifest'
import { rollup } from '../shared/ohlc'
import { bucketStart } from '../shared/time'
import { resolveRender } from '../shared/renderResolutions'
import { loadRange } from './dataLoader'
import { buildData, columnsForMode, emptyData, makeOptions, type ChartMode } from './chart'
import { initUI, currentMode, currentResolution, updateStats, setStatus } from './ui'

// Fraction of the visible span pre-fetched on each side, so panning within the
// margin costs no new request.
const MARGIN = 0.5

// Cap on rows read from a source tier for an explicitly-chosen resolution.
// Beyond this, a derived resolution isn't worth resampling client-side — that's
// where a precomputed tier earns its place — so we fall back to auto tiering.
const MAX_SOURCE_ROWS = 20_000

async function main() {
  const manifest: Manifest = await loadManifest()
  const chartEl = document.getElementById('chart')!

  let mode: ChartMode = currentMode()
  let resolution = currentResolution() // 'auto' | render-resolution key
  let chart: uPlot
  let applying = false // guard: ignore scale hooks we trigger ourselves
  let view = { min: manifest.globalStart, max: manifest.globalEnd }
  let loaded = { start: 0, end: -1, sourceRes: '', renderKey: '' }
  let reloadTimer: number | undefined
  let loadSeq = 0 // monotonic; a stale load whose seq is superseded must not apply

  const size = () => {
    // Fall back to the parent width; guard against a zero measurement taken
    // before layout has settled.
    const w = chartEl.clientWidth || chartEl.parentElement?.clientWidth || 800
    return { width: Math.max(320, w), height: Math.max(320, Math.round(w * 0.45)) }
  }

  const planFor = (minMs: number, maxMs: number) =>
    resolveRender(resolution, minMs, maxMs, manifest.globalStart, manifest.globalEnd, MARGIN, MAX_SOURCE_ROWS)

  function needsReload(minMs: number, maxMs: number): boolean {
    const p = planFor(minMs, maxMs)
    return (
      p.render.key !== loaded.renderKey ||
      p.render.sourceRes !== loaded.sourceRes ||
      minMs < loaded.start ||
      maxMs > loaded.end
    )
  }

  async function load(minMs: number, maxMs: number) {
    const seq = ++loadSeq
    const p = planFor(minMs, maxMs)
    const sourceTier = manifest.tiers.find((t) => t.res === p.render.sourceRes)
    if (!sourceTier) {
      throw new Error(`Manifest has no '${p.render.sourceRes}' tier for resolution '${p.render.key}'`)
    }
    const columns = columnsForMode(mode)

    // For a derived resolution, widen the read to whole render-buckets so the
    // edge bars are complete — otherwise the first/last resampled candle is
    // built from a partial set of source rows and its OHLC is wrong.
    let readT0 = p.t0
    let readT1 = p.t1
    if (p.render.derived) {
      readT0 = bucketStart(p.t0, p.render.bucketMs)
      readT1 = bucketStart(p.t1, p.render.bucketMs) + p.render.bucketMs
    }
    const files = selectFiles(sourceTier, readT0, readT1)

    setStatus('loading…')
    const base = await loadRange(sourceTier, readT0, readT1, columns, files)
    if (seq !== loadSeq) return // a newer load started while we awaited; drop this one

    // Resample in-browser for derived resolutions, using the same rollup() that
    // built the stored tiers.
    const series = p.render.derived ? rollup(base, p.render.bucketMs) : base
    const bars = series.ts.length
    const data = buildData(mode, series)

    loaded = { start: readT0, end: readT1, sourceRes: p.render.sourceRes, renderKey: p.render.key }

    applying = true
    // resetScales=true ranges the scales to the loaded (margin-padded) data;
    // then narrow x to the visible window — uPlot re-ranges auto-y to the view.
    chart.setData(data)
    chart.setScale('x', { min: minMs / 1000, max: maxMs / 1000 })
    applying = false

    updateStats({
      resLabel: p.render.label,
      derived: p.render.derived,
      sourceRes: p.render.sourceRes,
      rowsRead: base.rowsLoaded,
      bars,
      filesTouched: base.filesTouched,
      bytesFetched: base.bytesFetched,
    })

    if (p.downgraded) {
      setStatus(
        `${p.requested.label} would resample ~${Math.round(p.requestedSourceRows).toLocaleString()} ` +
          `${p.requested.sourceRes} rows here — too wide, showing ${p.render.label} instead. Zoom in.`,
      )
    } else if (p.render.derived) {
      setStatus(
        `resampled ${base.rowsLoaded.toLocaleString()} ${p.render.sourceRes} rows → ` +
          `${bars.toLocaleString()} ${p.render.label} bars in-browser`,
      )
    } else {
      setStatus('idle — drag to zoom · Shift+drag to pan · wheel to zoom · double-click to reset')
    }
  }

  // Interactive reloads are fire-and-forget; surface failures to the user
  // instead of leaving the status stuck on "loading…".
  function safeLoad(minMs: number, maxMs: number) {
    load(minMs, maxMs).catch((err) => {
      console.error(err)
      setStatus(`load failed: ${err?.message ?? err}`)
    })
  }

  function onView(minMs: number, maxMs: number) {
    if (applying) return
    view = { min: minMs, max: maxMs }
    window.clearTimeout(reloadTimer)
    reloadTimer = window.setTimeout(() => {
      if (needsReload(minMs, maxMs)) safeLoad(minMs, maxMs)
    }, 100)
  }

  function build() {
    if (chart) chart.destroy()
    const { width, height } = size()
    chart = new uPlot(
      makeOptions(mode, width, height, onView, { minMs: manifest.globalStart, maxMs: manifest.globalEnd }),
      emptyData(mode),
      chartEl,
    )
    loaded = { start: 0, end: -1, sourceRes: '', renderKey: '' } // force reload
  }

  initUI(
    (nextMode) => {
      mode = nextMode
      build() // series structure depends on candle/line mode
      safeLoad(view.min, view.max)
    },
    (nextResolution) => {
      resolution = nextResolution
      safeLoad(view.min, view.max) // resolution change: reload, no chart rebuild
    },
  )

  build()
  await load(manifest.globalStart, manifest.globalEnd)

  // Keep the chart sized to its container. Fires once after first layout (which
  // corrects any too-early initial measurement) and on every subsequent resize.
  let lastW = 0
  new ResizeObserver(() => {
    const { width, height } = size()
    if (width !== lastW) {
      lastW = width
      chart.setSize({ width, height })
    }
  }).observe(chartEl)
}

main().catch((err) => {
  console.error(err)
  setStatus(String(err?.message ?? err))
})
