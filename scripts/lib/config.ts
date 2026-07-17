import { join } from 'node:path'

// Shared configuration for the two write-path steps:
//   seed.ts     — one-time: synthesize the raw 1-min CSV (provenance)
//   generate.ts — the pipeline: raw CSV -> Parquet tiers + manifest

export const SERIES = 'SYNTH'
export const SERIES_START = Date.UTC(2020, 0, 1)
export const SERIES_END = Date.UTC(2025, 0, 1) // 5 years, 24/7
export const SEED = 42

// Column order of the raw CSV. `ts` is epoch milliseconds, UTC.
export const CSV_HEADER = 'ts,open,high,low,close'

const ROOT = process.cwd()

// Committed: the pipeline's input. Gzipped so it fits in the repo.
export const RAW_CSV_PATH = join(ROOT, 'data', 'raw', '1min.csv.gz')
// Generated: served statically by Vite and deployed to Pages.
export const OUT_DIR = join(ROOT, 'public', 'data')
