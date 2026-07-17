import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { RES } from '../shared/time'
import { generateMinuteSeries } from './lib/synth'
import { CSV_HEADER, RAW_CSV_PATH, SAMPLE_CSV_PATH, SERIES_END, SERIES_START, SEED } from './lib/config'

// One-time provenance step: fabricate the demo's *raw* data as a plain CSV.
//
// This is deliberately NOT part of the build. It answers "where did the data
// come from?" once; `npm run generate` then treats the CSV purely as an opaque
// input, exactly as it would treat a real vendor export. Swap in your own CSV
// with the same columns and the pipeline works unchanged.
const SAMPLE_ROWS = 200

function csvRow(ts: number, o: number, h: number, l: number, c: number): string {
  return `${ts},${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${c.toFixed(2)}\n`
}

const count = (SERIES_END - SERIES_START) / RES['1min']
if (count <= 0) throw new Error(`Empty range: start (${SERIES_START}) must be before end (${SERIES_END})`)

console.log(`Seeding raw 1-min CSV: ${new Date(SERIES_START).toISOString()} -> ${new Date(SERIES_END).toISOString()}`)
console.time('synthesize')
const s = generateMinuteSeries({ startMs: SERIES_START, count, seed: SEED })
console.timeEnd('synthesize')
console.log(`  rows: ${s.ts.length.toLocaleString()}`)

// Stream rows out so we never hold the whole ~110 MB CSV in memory.
function* rows(): Generator<string> {
  yield CSV_HEADER + '\n'
  for (let i = 0; i < s.ts.length; i++) {
    yield csvRow(s.ts[i], s.open[i], s.high[i], s.low[i], s.close[i])
  }
}

let uncompressed = 0
function* counted(): Generator<string> {
  for (const r of rows()) {
    uncompressed += r.length
    yield r
  }
}

mkdirSync(dirname(RAW_CSV_PATH), { recursive: true })
console.time('write csv.gz')
await pipeline(Readable.from(counted()), createGzip({ level: 9 }), createWriteStream(RAW_CSV_PATH))
console.timeEnd('write csv.gz')

// A small plain-text sample so the input format is readable on GitHub without
// gunzipping, and usable as a test fixture.
mkdirSync(dirname(SAMPLE_CSV_PATH), { recursive: true })
let sample = CSV_HEADER + '\n'
for (let i = 0; i < Math.min(SAMPLE_ROWS, s.ts.length); i++) {
  sample += csvRow(s.ts[i], s.open[i], s.high[i], s.low[i], s.close[i])
}
writeFileSync(SAMPLE_CSV_PATH, sample)

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`
const gz = statSync(RAW_CSV_PATH).size
console.log(`\nraw CSV      : ${mb(uncompressed)} (uncompressed)`)
console.log(`raw CSV .gz  : ${mb(gz)}  -> ${join('data', 'raw')} (committed)`)
console.log(`compression  : ${(uncompressed / gz).toFixed(1)}x`)
console.log(`sample       : ${SAMPLE_ROWS} rows -> ${SAMPLE_CSV_PATH.split(/[\\/]/).slice(-2).join('/')}`)
