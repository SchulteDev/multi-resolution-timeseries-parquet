import type { ChartMode } from './chart'
import type { Resolution } from '../shared/time'

export interface StatView {
  resLabel: string
  derived: boolean
  sourceRes: Resolution
  rowsRead: number
  bars: number
  filesTouched: number
  bytesFetched: number
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(2)} MB`
}

const el = (id: string) => document.getElementById(id)!

export function initUI(
  onModeChange: (mode: ChartMode) => void,
  onResolutionChange: (resolution: string) => void,
): void {
  const candles = el('mode-candles') as HTMLInputElement
  const line = el('mode-line') as HTMLInputElement
  candles.addEventListener('change', () => candles.checked && onModeChange('candles'))
  line.addEventListener('change', () => line.checked && onModeChange('line'))

  const res = el('res-select') as HTMLSelectElement
  res.addEventListener('change', () => onResolutionChange(res.value))
}

export function currentMode(): ChartMode {
  return (el('mode-line') as HTMLInputElement).checked ? 'line' : 'candles'
}

export function currentResolution(): string {
  return (el('res-select') as HTMLSelectElement).value
}

export function setStatus(text: string): void {
  el('status').textContent = text
}

export function updateStats(s: StatView): void {
  el('stat-res').textContent = s.resLabel + (s.derived ? ' ✷' : '')
  el('stat-source').textContent = s.derived ? `${s.sourceRes} (resampled)` : `${s.sourceRes} (stored)`
  el('stat-bars').textContent = s.derived
    ? `${s.rowsRead.toLocaleString()} → ${s.bars.toLocaleString()}`
    : s.bars.toLocaleString()
  el('stat-files').textContent = String(s.filesTouched)
  el('stat-bytes').textContent = fmtBytes(s.bytesFetched)
}
