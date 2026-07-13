import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RES, RESOLUTIONS, type Resolution } from '../shared/time'
import { rollup, seriesLength, type Series } from '../shared/ohlc'
import type { Manifest, FileInfo, TierInfo } from '../shared/manifest'
import { generateMinuteSeries } from './lib/synth'
import { partitionByMonth } from './lib/partition'
import { serializeTier } from './lib/writeTier'

// ---- Config -----------------------------------------------------------------
const SERIES = 'SYNTH'
const START = Date.UTC(2020, 0, 1)
const END = Date.UTC(2025, 0, 1) // 5 years, 24/7
const SEED = 42

const OUT_DIR = join(process.cwd(), 'public', 'data')

// ---- Helpers ----------------------------------------------------------------
let totalBytes = 0

function writeParquet(relPath: string, series: Series): FileInfo {
  if (series.ts.length === 0) throw new Error(`Refusing to write empty series to ${relPath}`)
  const abs = join(OUT_DIR, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  const buf = serializeTier(series)
  writeFileSync(abs, new Uint8Array(buf))
  totalBytes += buf.byteLength
  return {
    path: `data/${relPath.split('\\').join('/')}`,
    start: series.ts[0],
    end: series.ts[series.ts.length - 1],
    rows: seriesLength(series),
    bytes: buf.byteLength,
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

// ---- Build ------------------------------------------------------------------
console.log(`Generating ${SERIES}: ${new Date(START).toISOString()} -> ${new Date(END).toISOString()}`)
rmSync(OUT_DIR, { recursive: true, force: true })

const minuteCount = (END - START) / RES['1min']
if (minuteCount <= 0) throw new Error(`Empty range: START (${START}) must be before END (${END})`)
console.time('generate 1min')
const minute = generateMinuteSeries({ startMs: START, count: minuteCount, seed: SEED })
console.timeEnd('generate 1min')
console.log(`  1min bars: ${minute.ts.length.toLocaleString()}`)

// Cascade coarser tiers from the next-finer one (OHLC composes -> exact).
console.time('rollup')
const s15 = rollup(minute, RES['15min'])
const s1h = rollup(s15, RES['1h'])
const s1d = rollup(s1h, RES['1d'])
console.timeEnd('rollup')

const seriesByRes: Record<Resolution, Series> = {
  '1min': minute,
  '15min': s15,
  '1h': s1h,
  '1d': s1d,
}

const tiers: TierInfo[] = []

for (const res of RESOLUTIONS) {
  const series = seriesByRes[res]
  const files: FileInfo[] = []

  if (res === '1min') {
    // Partition the big tier by month; keep the rest as a single file.
    for (const part of partitionByMonth(series)) {
      files.push(writeParquet(join('1min', `${part.key}.parquet`), part.series))
    }
  } else {
    files.push(writeParquet(join(res, 'all.parquet'), series))
  }

  tiers.push({ res, bucketMs: RES[res], files })
  console.log(`  ${res}: ${series.ts.length.toLocaleString()} rows across ${files.length} file(s)`)
}

const manifest: Manifest = {
  series: SERIES,
  generatedAt: new Date(START).toISOString(), // deterministic (no wall clock)
  globalStart: minute.ts[0],
  globalEnd: minute.ts[minute.ts.length - 1],
  tiers,
}

const manifestJson = JSON.stringify(manifest, null, 2)
const manifestBytes = new TextEncoder().encode(manifestJson)
writeFileSync(join(OUT_DIR, 'manifest.json'), manifestBytes)
totalBytes += manifestBytes.byteLength

console.log(`\nWrote manifest with ${tiers.length} tiers to public/data/manifest.json`)
console.log(`Done. Total on-disk: ${mb(totalBytes)}`)
