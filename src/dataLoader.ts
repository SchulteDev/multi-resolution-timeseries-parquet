import { asyncBufferFromUrl, parquetReadObjects, parquetMetadataAsync } from 'hyparquet'
import type { AsyncBuffer, FileMetaData } from 'hyparquet'
import { rowRange, type FileInfo, type TierInfo } from '../shared/manifest'
import { assetUrl } from './manifest'

export interface LoadResult {
  ts: number[]
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  rowsLoaded: number
  filesTouched: number
  bytesFetched: number
}

interface CachedFile {
  buffer: AsyncBuffer
  counter: { bytes: number }
  metadata: FileMetaData
}

// Our Parquet footers are only ~0.5-7 KB. hyparquet's default metadata read
// grabs the last 512 KB to locate the footer — for our small files that would
// dominate every load. 16 KB covers every tier's footer with headroom, and
// hyparquet issues a second request if a footer ever exceeds it.
const FOOTER_FETCH_SIZE = 1 << 14 // 16 KB

// One AsyncBuffer + parsed footer per file, kept for the session. Caching the
// metadata means footers are read once, not on every zoom.
const cache = new Map<string, CachedFile>()

// Wrap an AsyncBuffer so every range request (slice) adds to a byte counter.
// This is what makes column projection and tier selection *visible*: fewer
// columns or a coarser tier => fewer bytes over the wire.
function countingWrapper(raw: AsyncBuffer): { buffer: AsyncBuffer; counter: { bytes: number } } {
  const counter = { bytes: 0 }
  const buffer: AsyncBuffer = {
    byteLength: raw.byteLength,
    slice: async (start, end) => {
      const buf = await raw.slice(start, end)
      counter.bytes += buf.byteLength // count bytes actually received, not requested
      return buf
    },
  }
  return { buffer, counter }
}

// Returns the cached file plus how many bytes the footer read consumed (only
// non-zero the first time a file is touched).
async function getFile(file: FileInfo): Promise<{ entry: CachedFile; footerBytes: number }> {
  const existing = cache.get(file.path)
  if (existing) return { entry: existing, footerBytes: 0 }

  try {
    // Pass byteLength from the manifest so hyparquet skips the HEAD request.
    const raw = await asyncBufferFromUrl({ url: assetUrl(file.path), byteLength: file.bytes })
    const { buffer, counter } = countingWrapper(raw)
    const metadata = await parquetMetadataAsync(buffer, { initialFetchSize: FOOTER_FETCH_SIZE })
    const footerBytes = counter.bytes
    const entry: CachedFile = { buffer, counter, metadata }
    cache.set(file.path, entry)
    return { entry, footerBytes }
  } catch (err) {
    // Attach the path/size so a 404 or stale manifest is diagnosable rather
    // than a bare hyparquet offset error.
    throw new Error(`Failed to read ${file.path} (${file.bytes} B): ${(err as Error).message}`)
  }
}

/**
 * Load OHLC rows for [t0, t1] from a tier, reading only `columns` and only the
 * row range each file needs. Because the data is gapless and regular, the row
 * range is pure arithmetic (no value scan); hyparquet then fetches only the
 * row groups overlapping that range.
 */
export async function loadRange(
  tier: TierInfo,
  t0: number,
  t1: number,
  columns: string[],
  files: FileInfo[],
): Promise<LoadResult> {
  const out: LoadResult = {
    ts: [], open: [], high: [], low: [], close: [],
    rowsLoaded: 0, filesTouched: 0, bytesFetched: 0,
  }

  for (const file of files) {
    const range = rowRange(file, tier.bucketMs, t0, t1)
    if (!range) continue
    const { rowStart, rowEnd } = range

    const { entry, footerBytes } = await getFile(file)
    const before = entry.counter.bytes
    const rows = await parquetReadObjects({
      file: entry.buffer,
      metadata: entry.metadata,
      columns,
      rowStart,
      rowEnd,
    })
    out.bytesFetched += footerBytes + (entry.counter.bytes - before)
    out.filesTouched++

    const wantOhlc = columns.includes('open')
    for (const r of rows) {
      out.ts.push(Number(r.ts))
      out.close.push(r.close)
      if (wantOhlc) {
        out.open.push(r.open)
        out.high.push(r.high)
        out.low.push(r.low)
      }
    }
  }

  out.rowsLoaded = out.ts.length
  return out
}
