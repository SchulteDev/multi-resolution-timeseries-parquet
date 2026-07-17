import type { ChartMode } from './chart'
import type { QueryPlan } from './query'

const el = (id: string) => document.getElementById(id)!

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(2)} MB`
}

const fmtTime = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
const num = (n: number) => Math.round(n).toLocaleString()

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

/**
 * Render the query as pseudo-SQL. There is no SQL engine — this is what the
 * request *means*, written the way you'd ask a database, to make the point that
 * the same question is answered by file layout instead of a query planner.
 */
function toSql(plan: QueryPlan): string {
  const cols = plan.columns.join(', ')
  const at = plan.derived
    ? `AT RESOLUTION ${plan.resolution.key}      -- no stored tier: resampled from ${plan.sourceRes}`
    : `AT RESOLUTION ${plan.resolution.key}      -- stored tier`
  return (
    `SELECT ${cols}\n` +
    `FROM synth\n` +
    `WHERE ts BETWEEN '${fmtTime(plan.from)}' AND '${fmtTime(plan.to)}'\n` +
    at
  )
}

function planRows(plan: QueryPlan): [string, string][] {
  const skipped = plan.rowGroupsTotal - plan.rowGroupsRead
  const groupRange =
    plan.rowGroupsRead === 0
      ? '—'
      : plan.firstRowGroup === plan.lastRowGroup
        ? `#${plan.firstRowGroup}`
        : `#${plan.firstRowGroup}–${plan.lastRowGroup}`
  const pct = plan.fileBytes ? (plan.bytesFetched / plan.fileBytes) * 100 : 0

  const rows: [string, string][] = [
    ['tier', `${plan.sourceRes} (stored)${plan.derived ? ` → resampled to ${plan.resolution.key}` : ''}`],
    ['file', `${plan.filePath} · ${fmtBytes(plan.fileBytes)}`],
    [
      'row groups',
      `${groupRange} — ${num(plan.rowGroupsRead)} of ${num(plan.rowGroupsTotal)} read · ` +
        `${num(skipped)} skipped via footer stats`,
    ],
    ['columns', `${plan.columns.length} of ${plan.columnsTotal} read (${plan.columns.join(', ')})`],
  ]
  if (plan.derived) {
    rows.push([
      'resample',
      `${num(plan.rowsRead)} ${plan.sourceRes} rows → ${num(plan.bars)} ${plan.resolution.key} bars (in-browser)`,
    ])
  } else {
    rows.push(['rows', `${num(plan.bars)} bars drawn`])
  }
  rows.push([
    'fetched',
    `${fmtBytes(plan.bytesFetched)} · ${pct.toFixed(2)}% of file · ${plan.requests} range request${plan.requests === 1 ? '' : 's'}`,
  ])
  return rows
}

export function updatePlan(plan: QueryPlan): void {
  el('sql').textContent = toSql(plan)

  el('plan').innerHTML = ''
  for (const [k, v] of planRows(plan)) {
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    dd.textContent = v
    el('plan').append(dt, dd)
  }

  const note = el('plan-note')
  if (plan.downgradedFrom) {
    note.textContent =
      `${plan.downgradedFrom.label} would need ~${num(plan.downgradedRows ?? 0)} ` +
      `${plan.downgradedFrom.sourceRes} rows for this window — too wide to resample, ` +
      `so a precomputed tier is used instead. Zoom in to see it resampled.`
    note.hidden = false
  } else {
    note.hidden = true
  }
}
