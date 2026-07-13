import uPlot from 'uplot'
import type { LoadResult } from './dataLoader'

export type ChartMode = 'candles' | 'line'

const BULL = '#3ea56b'
const BEAR = '#e05a5a'
const WICK = '#8a8f98'
const ACCENT = '#4c8bf5'

// Custom candlestick renderer. uPlot has no built-in OHLC mark, so we draw
// wick + body per visible bar in a `draw` hook. Data layout is
// [xs, open, high, low, close]; the O/H/L/C series carry the values (so the
// y-scale autoscales to the wick extremes and the cursor can read them) but
// render nothing themselves.
function candlestickPlugin(): uPlot.Plugin {
  function draw(u: uPlot) {
    const ctx = u.ctx
    const [iMin, iMax] = (u.series[0] as unknown as { idxs: [number, number] }).idxs
    const colWidth = u.bbox.width / Math.max(1, iMax - iMin)
    const bodyWidth = Math.max(1, Math.min(18, colWidth - 2))

    ctx.save()
    for (let i = iMin; i <= iMax; i++) {
      const xVal = u.data[0][i] as number
      const o = u.data[1][i] as number
      const h = u.data[2][i] as number
      const l = u.data[3][i] as number
      const c = u.data[4][i] as number
      if (o == null) continue

      const x = Math.round(u.valToPos(xVal, 'x', true))
      const yH = u.valToPos(h, 'y', true)
      const yL = u.valToPos(l, 'y', true)
      const yO = u.valToPos(o, 'y', true)
      const yC = u.valToPos(c, 'y', true)
      const up = c >= o

      ctx.strokeStyle = WICK
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, yH)
      ctx.lineTo(x, yL)
      ctx.stroke()

      ctx.fillStyle = up ? BULL : BEAR
      const top = Math.min(yO, yC)
      const height = Math.max(1, Math.abs(yC - yO))
      ctx.fillRect(Math.round(x - bodyWidth / 2), Math.round(top), Math.round(bodyWidth), Math.round(height))
    }
    ctx.restore()
  }
  return { hooks: { draw: [draw] } }
}

// Wheel to zoom the x-axis around the cursor (uPlot only drag-zooms by default).
function wheelZoomPlugin(factor = 0.85): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over
        over.addEventListener(
          'wheel',
          (e: WheelEvent) => {
            e.preventDefault()
            const rect = over.getBoundingClientRect()
            const cursorX = e.clientX - rect.left
            const xMin = u.scales.x.min as number
            const xMax = u.scales.x.max as number
            const xVal = u.posToVal(cursorX, 'x')
            const f = e.deltaY < 0 ? factor : 1 / factor
            u.setScale('x', { min: xVal - (xVal - xMin) * f, max: xVal + (xMax - xVal) * f })
          },
          { passive: false },
        )
      },
    },
  }
}

const nullPaths = () => null

export function buildData(mode: ChartMode, r: LoadResult): uPlot.AlignedData {
  const xs = r.ts.map((ms) => ms / 1000) // uPlot time scale is in seconds
  return mode === 'candles' ? [xs, r.open, r.high, r.low, r.close] : [xs, r.close]
}

// Empty data with the right number of series for the mode. The array count must
// match the configured series or uPlot's initial scale ranging breaks.
export function emptyData(mode: ChartMode): uPlot.AlignedData {
  return mode === 'candles' ? [[], [], [], [], []] : [[], []]
}

/** Build uPlot options for the given mode. `onView` fires (in ms) on any x-scale change. */
export function makeOptions(
  mode: ChartMode,
  width: number,
  height: number,
  onView: (minMs: number, maxMs: number) => void,
): uPlot.Options {
  const series: uPlot.Series[] =
    mode === 'candles'
      ? [
          {},
          { label: 'O', scale: 'y', paths: nullPaths, points: { show: false } },
          { label: 'H', scale: 'y', paths: nullPaths, points: { show: false } },
          { label: 'L', scale: 'y', paths: nullPaths, points: { show: false } },
          { label: 'C', scale: 'y', paths: nullPaths, points: { show: false } },
        ]
      : [{}, { label: 'close', scale: 'y', stroke: ACCENT, width: 1.5, points: { show: false } }]

  return {
    width,
    height,
    scales: { x: { time: true }, y: { auto: true } },
    cursor: { drag: { x: true, y: false }, y: false },
    series,
    axes: [
      { stroke: '#9aa0a6', grid: { stroke: 'rgba(255,255,255,0.06)' } },
      { stroke: '#9aa0a6', grid: { stroke: 'rgba(255,255,255,0.06)' } },
    ],
    hooks: {
      setScale: [
        (u, key) => {
          if (key === 'x') onView((u.scales.x.min as number) * 1000, (u.scales.x.max as number) * 1000)
        },
      ],
    },
    plugins: mode === 'candles' ? [candlestickPlugin(), wheelZoomPlugin()] : [wheelZoomPlugin()],
  }
}
