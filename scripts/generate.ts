import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RES, RESOLUTIONS, type Resolution } from '../shared/time'
import { rollup, type Series } from '../shared/ohlc'
import type { Manifest, FileInfo, TierInfo } from '../shared/manifest'
import { OUT_DIR, RAW_CSV_PATH, SERIES, SERIES_START } from './lib/config'
import { readCsv } from './lib/readCsv'
import { footerBytes, serializeTier } from './lib/writeTier'

// The pipeline: raw CSV -> pre-aggregated Parquet tiers + manifest.
//
// Nothing is invented here — the 1-min bars come from data/raw/1min.csv.gz
// (see scripts/seed.ts for how that demo CSV was made). Point RAW_CSV_PATH at
// your own CSV with the same columns and this works unchanged.

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
    rows: series.ts.length,
    bytes: buf.byteLength,
    footerBytes: footerBytes(buf),
  }
}

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`

// ---- 1. Read the raw CSV -----------------------------------------------------
console.log(`Reading ${RAW_CSV_PATH.split(/[\\/]/).slice(-3).join('/')}`)
console.time('read csv')
const minute = await readCsv(RAW_CSV_PATH)
console.timeEnd('read csv')
console.log(`  1min bars: ${minute.ts.length.toLocaleString()}`)

// ---- 2. Cascade the tiers ----------------------------------------------------
// Coarser tiers are built from the next-finer one, not from the raw data:
// OHLC composes, so the result is identical and far cheaper.
console.time('rollup')
const seriesByRes: Record<Resolution, Series> = {
  '1min': minute,
  '15min': rollup(minute, RES['15min']),
  '1h': rollup(rollup(minute, RES['15min']), RES['1h']),
  '1d': rollup(rollup(rollup(minute, RES['15min']), RES['1h']), RES['1d']),
}
console.timeEnd('rollup')

// ---- 3. Write one Parquet file per tier --------------------------------------
// Deliberately a single file per tier — including the ~50 MB 1-min tier — so
// the demo shows Parquet's own footer + row-group stats + range requests doing
// the work, rather than a partition lookup doing it. See the README on why
// production appends would partition instead.
rmSync(OUT_DIR, { recursive: true, force: true })

const tiers: TierInfo[] = []
for (const res of RESOLUTIONS) {
  const series = seriesByRes[res]
  const info = writeParquet(join(res, 'all.parquet'), series)
  tiers.push({ res, bucketMs: RES[res], files: [info] })
  console.log(
    `  ${res.padEnd(5)}: ${series.ts.length.toLocaleString().padStart(9)} rows  ` +
      `${mb(info.bytes).padStart(8)}  footer ${kb(info.footerBytes)}`,
  )
}

// ---- 4. Manifest -------------------------------------------------------------
const manifest: Manifest = {
  series: SERIES,
  generatedAt: new Date(SERIES_START).toISOString(), // deterministic (no wall clock)
  globalStart: minute.ts[0],
  globalEnd: minute.ts[minute.ts.length - 1],
  tiers,
}
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
writeFileSync(join(OUT_DIR, 'manifest.json'), manifestBytes)
totalBytes += manifestBytes.byteLength

console.log(`\nWrote ${tiers.length} tiers + manifest to public/data. Total: ${mb(totalBytes)}`)
