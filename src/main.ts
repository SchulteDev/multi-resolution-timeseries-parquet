import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import './style.css'
import { loadManifest } from './manifest'
import type { Manifest } from '../shared/manifest'
import { query, planWindow, type QuerySpec } from './query'
import { buildData, columnsForMode, emptyData, makeOptions, type ChartMode } from './chart'
import { initUI, currentMode, currentResolution, updatePlan, setStatus } from './ui'

const IDLE = 'idle — drag to zoom · Shift+drag to pan · wheel to zoom · double-click to reset'

async function main() {
  const manifest: Manifest = await loadManifest()
  const chartEl = document.getElementById('chart')!

  let mode: ChartMode = currentMode()
  let resolution = currentResolution() // 'auto' | render-resolution key
  let chart: uPlot
  let applying = false // guard: ignore scale hooks we trigger ourselves
  let view = { min: manifest.globalStart, max: manifest.globalEnd }
  let loaded = { from: 0, to: -1, sourceRes: '', renderKey: '' }
  let reloadTimer: number | undefined
  let loadSeq = 0 // monotonic; a stale load whose seq is superseded must not apply

  const size = () => {
    // Fall back to the parent width; guard against a zero measurement taken
    // before layout has settled.
    const w = chartEl.clientWidth || chartEl.parentElement?.clientWidth || 800
    return { width: Math.max(320, w), height: Math.max(320, Math.round(w * 0.45)) }
  }

  const specFor = (minMs: number, maxMs: number): QuerySpec => ({
    from: minMs,
    to: maxMs,
    resolution,
    columns: columnsForMode(mode),
  })

  function needsReload(minMs: number, maxMs: number): boolean {
    const w = planWindow(manifest, specFor(minMs, maxMs))
    return (
      w.renderKey !== loaded.renderKey ||
      w.sourceRes !== loaded.sourceRes ||
      minMs < loaded.from ||
      maxMs > loaded.to
    )
  }

  async function load(minMs: number, maxMs: number) {
    const seq = ++loadSeq
    const spec = specFor(minMs, maxMs)

    setStatus('running query…')
    const { series, plan } = await query(manifest, spec)
    if (seq !== loadSeq) return // a newer query started while we awaited; drop this one

    const w = planWindow(manifest, spec)
    loaded = { from: w.readFrom, to: w.readTo, sourceRes: w.sourceRes, renderKey: w.renderKey }

    applying = true
    // resetScales=true ranges the scales to the loaded (margin-padded) data;
    // then narrow x to the visible window — uPlot re-ranges auto-y to the view.
    chart.setData(buildData(mode, series))
    chart.setScale('x', { min: minMs / 1000, max: maxMs / 1000 })
    applying = false

    updatePlan(plan)
    setStatus(IDLE)
  }

  // Interactive reloads are fire-and-forget; surface failures to the user
  // instead of leaving the status stuck on "running query…".
  function safeLoad(minMs: number, maxMs: number) {
    load(minMs, maxMs).catch((err) => {
      console.error(err)
      setStatus(`query failed: ${err?.message ?? err}`)
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
    loaded = { from: 0, to: -1, sourceRes: '', renderKey: '' } // force reload
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
