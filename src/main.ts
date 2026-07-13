import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import './style.css'
import { loadManifest } from './manifest'
import { selectFiles, type Manifest } from '../shared/manifest'
import { selectTier } from '../shared/tierSelect'
import { loadRange } from './dataLoader'
import { buildData, emptyData, makeOptions, type ChartMode } from './chart'
import { initUI, currentMode, updateStats, setStatus } from './ui'

// Fraction of the visible span pre-fetched on each side, so panning within the
// margin costs no new request.
const MARGIN = 0.5

async function main() {
  const manifest: Manifest = await loadManifest()
  const chartEl = document.getElementById('chart')!

  let mode: ChartMode = currentMode()
  let chart: uPlot
  let applying = false // guard: ignore scale hooks we trigger ourselves
  let view = { min: manifest.globalStart, max: manifest.globalEnd }
  let loaded = { start: 0, end: -1, res: '' }
  let reloadTimer: number | undefined

  const size = () => {
    // Fall back to the parent width; guard against a zero measurement taken
    // before layout has settled.
    const w = chartEl.clientWidth || chartEl.parentElement?.clientWidth || 800
    return { width: Math.max(320, w), height: Math.max(320, Math.round(w * 0.45)) }
  }

  function tierFor(spanMs: number) {
    const choice = selectTier(spanMs)
    const tier = manifest.tiers.find((t) => t.res === choice.res)!
    return { choice, tier }
  }

  function needsReload(minMs: number, maxMs: number): boolean {
    const { tier } = tierFor(maxMs - minMs)
    return tier.res !== loaded.res || minMs < loaded.start || maxMs > loaded.end
  }

  async function load(minMs: number, maxMs: number) {
    const span = maxMs - minMs
    const { choice, tier } = tierFor(span)
    const pad = span * MARGIN
    const t0 = Math.max(manifest.globalStart, minMs - pad)
    const t1 = Math.min(manifest.globalEnd, maxMs + pad)
    const columns = mode === 'candles' ? ['ts', 'open', 'high', 'low', 'close'] : ['ts', 'close']
    const files = selectFiles(tier, t0, t1)

    setStatus('loading…')
    const result = await loadRange(tier, t0, t1, columns, files)
    loaded = { start: t0, end: t1, res: tier.res }

    applying = true
    // resetScales=true ranges the scales to the loaded (margin-padded) data;
    // then narrow x to the visible window — uPlot re-ranges auto-y to the view.
    chart.setData(buildData(mode, result))
    chart.setScale('x', { min: minMs / 1000, max: maxMs / 1000 })
    applying = false

    updateStats({
      tier: tier.res,
      estPoints: choice.estPoints,
      rowsLoaded: result.rowsLoaded,
      filesTouched: result.filesTouched,
      bytesFetched: result.bytesFetched,
    })
    setStatus('idle — drag to zoom, wheel to zoom, double-click to reset')
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
    chart = new uPlot(makeOptions(mode, width, height, onView), emptyData(mode), chartEl)
    loaded = { start: 0, end: -1, res: '' } // force a reload for the new mode
  }

  initUI((next) => {
    mode = next
    build()
    void load(view.min, view.max)
  })

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
