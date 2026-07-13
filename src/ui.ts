import type { ChartMode } from './chart'

export interface StatView {
  tier: string
  estPoints: number
  rowsLoaded: number
  filesTouched: number
  bytesFetched: number
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(2)} MB`
}

const el = (id: string) => document.getElementById(id)!

export function initUI(onModeChange: (mode: ChartMode) => void): void {
  const candles = el('mode-candles') as HTMLInputElement
  const line = el('mode-line') as HTMLInputElement
  candles.addEventListener('change', () => candles.checked && onModeChange('candles'))
  line.addEventListener('change', () => line.checked && onModeChange('line'))
}

export function currentMode(): ChartMode {
  return (el('mode-line') as HTMLInputElement).checked ? 'line' : 'candles'
}

export function setStatus(text: string): void {
  el('status').textContent = text
}

export function updateStats(s: StatView): void {
  el('stat-tier').textContent = s.tier
  el('stat-points').textContent = Math.round(s.estPoints).toLocaleString()
  el('stat-rows').textContent = s.rowsLoaded.toLocaleString()
  el('stat-files').textContent = String(s.filesTouched)
  el('stat-bytes').textContent = fmtBytes(s.bytesFetched)
}
