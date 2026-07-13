import type { Resolution } from './time'

// One Parquet file within a tier. `path` is relative to the site root (joined
// with BASE_URL at read time); `start`/`end` are the first/last bucket ts.
export interface FileInfo {
  path: string
  start: number
  end: number
  rows: number
  bytes: number // file size, so the reader can skip a HEAD request
}

export interface TierInfo {
  res: Resolution
  bucketMs: number
  files: FileInfo[]
}

// The single index the frontend fetches first. Decouples the frontend from the
// on-disk partition layout: it picks files by [start, end], never by naming.
export interface Manifest {
  series: string
  // Deterministic: set to the series START date (not wall-clock time), so CI
  // regeneration is byte-stable. Not a real generation timestamp.
  generatedAt: string
  globalStart: number
  globalEnd: number
  tiers: TierInfo[]
}

// Files in a tier that overlap the (already margin-padded) visible range.
export function selectFiles(tier: TierInfo, t0: number, t1: number): FileInfo[] {
  return tier.files.filter((f) => f.end >= t0 && f.start <= t1)
}

// Map a time window [t0, t1] onto a file's row range [rowStart, rowEnd) by
// arithmetic — the tier is gapless and regular, so row i covers
// file.start + i*bucketMs (no value scan). Returns null when the window doesn't
// overlap the file. rowEnd is exclusive, matching hyparquet's convention.
export function rowRange(
  file: FileInfo,
  bucketMs: number,
  t0: number,
  t1: number,
): { rowStart: number; rowEnd: number } | null {
  const rowStart = Math.max(0, Math.floor((t0 - file.start) / bucketMs))
  const rowEnd = Math.min(file.rows, Math.floor((t1 - file.start) / bucketMs) + 1)
  return rowEnd <= rowStart ? null : { rowStart, rowEnd }
}
