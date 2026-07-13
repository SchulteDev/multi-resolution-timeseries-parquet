import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import './style.css'
import { loadManifest } from './manifest'
import { selectFiles, type Manifest } from '../shared/manifest'
import { rollup } from '../shared/ohlc'
import { resolveRender } from '../shared/renderResolutions'
import { loadRange } from './dataLoader'
import { buildData, emptyData, makeOptions, type ChartMode } from './chart'
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
    const p = planFor(minMs, maxMs)
    const sourceTier = manifest.tiers.find((t) => t.res === p.render.sourceRes)!
    const columns = mode === 'candles' ? ['ts', 'open', 'high', 'low', 'close'] : ['ts', 'close']
    const files = selectFiles(sourceTier, p.t0, p.t1)

    setStatus('loading…')
    const base = await loadRange(sourceTier, p.t0, p.t1, columns, files)

    // Resample in-browser for derived resolutions, using the same rollup() that
    // built the stored tiers.
    let bars = base.rowsLoaded
    let data
    if (p.render.derived) {
      const agg = rollup(
        { ts: base.ts, open: base.open, high: base.high, low: base.low, close: base.close },
        p.render.bucketMs,
      )
      bars = agg.ts.length
      data = buildData(mode, { ...agg, rowsLoaded: bars, filesTouched: base.filesTouched, bytesFetched: base.bytesFetched })
    } else {
      data = buildData(mode, base)
    }

    loaded = { start: p.t0, end: p.t1, sourceRes: p.render.sourceRes, renderKey: p.render.key }

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

  function onView(minMs: number, maxMs: number) {
    if (applying) return
    view = { min: minMs, max: maxMs }
    window.clearTimeout(reloadTimer)
    reloadTimer = window.setTimeout(() => {
      if (needsReload(minMs, maxMs)) void load(minMs, maxMs)
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
      void load(view.min, view.max)
    },
    (nextResolution) => {
      resolution = nextResolution
      void load(view.min, view.max) // resolution change: reload, no chart rebuild
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
