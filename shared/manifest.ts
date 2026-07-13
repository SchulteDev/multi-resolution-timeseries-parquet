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
  generatedAt: string
  globalStart: number
  globalEnd: number
  tiers: TierInfo[]
}

// Files in a tier that overlap the (already margin-padded) visible range.
export function selectFiles(tier: TierInfo, t0: number, t1: number): FileInfo[] {
  return tier.files.filter((f) => f.end >= t0 && f.start <= t1)
}
