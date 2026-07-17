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
  requests: number // HTTP range requests issued
  rowGroupsTotal: number // row groups in the touched file(s)
  rowGroupsRead: number // row groups actually fetched; the rest are skipped
  firstRowGroup: number
  lastRowGroup: number
}

interface Counter {
  bytes: number
  requests: number
}

interface CachedFile {
  buffer: AsyncBuffer
  counter: Counter
  metadata: FileMetaData
}

// One AsyncBuffer + parsed footer per file, kept for the session. Caching the
// metadata means footers are read once, not on every zoom.
const cache = new Map<string, CachedFile>()

// Wrap an AsyncBuffer so every range request (slice) adds to a byte counter.
// This is what makes column projection and tier selection *visible*: fewer
// columns or a coarser tier => fewer bytes over the wire.
function countingWrapper(raw: AsyncBuffer): { buffer: AsyncBuffer; counter: Counter } {
  const counter: Counter = { bytes: 0, requests: 0 }
  const buffer: AsyncBuffer = {
    byteLength: raw.byteLength,
    slice: async (start, end) => {
      const buf = await raw.slice(start, end)
      counter.bytes += buf.byteLength // count bytes actually received, not requested
      counter.requests++
      return buf
    },
  }
  return { buffer, counter }
}

/**
 * Which row groups a row range touches. hyparquet fetches only the row groups
 * overlapping [rowStart, rowEnd) — this reports that same selection so the UI
 * can show how many were skipped via the footer's min/max stats.
 */
function rowGroupsFor(metadata: FileMetaData, rowStart: number, rowEnd: number) {
  let offset = 0
  let read = 0
  let first = -1
  let last = -1
  metadata.row_groups.forEach((rg, i) => {
    const groupStart = offset
    const groupEnd = offset + Number(rg.num_rows)
    offset = groupEnd
    if (groupEnd > rowStart && groupStart < rowEnd) {
      read++
      if (first < 0) first = i
      last = i
    }
  })
  return { total: metadata.row_groups.length, read, first, last }
}

// Returns the cached file plus what the footer read cost (only non-zero the
// first time a file is touched — after that the metadata is cached).
async function getFile(
  file: FileInfo,
): Promise<{ entry: CachedFile; footerBytes: number; footerRequests: number }> {
  const existing = cache.get(file.path)
  if (existing) return { entry: existing, footerBytes: 0, footerRequests: 0 }

  try {
    // The manifest carries the exact file size and footer size, so the metadata
    // read costs exactly one minimal range request — no HEAD, no 512 KB default
    // tail fetch, no second request to cover an underestimated footer.
    const raw = await asyncBufferFromUrl({ url: assetUrl(file.path), byteLength: file.bytes })
    const { buffer, counter } = countingWrapper(raw)
    const metadata = await parquetMetadataAsync(buffer, { initialFetchSize: file.footerBytes })
    const entry: CachedFile = { buffer, counter, metadata }
    cache.set(file.path, entry)
    return { entry, footerBytes: counter.bytes, footerRequests: counter.requests }
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
    rowsLoaded: 0, filesTouched: 0, bytesFetched: 0, requests: 0,
    rowGroupsTotal: 0, rowGroupsRead: 0, firstRowGroup: -1, lastRowGroup: -1,
  }

  for (const file of files) {
    const range = rowRange(file, tier.bucketMs, t0, t1)
    if (!range) continue
    const { rowStart, rowEnd } = range

    const { entry, footerBytes, footerRequests } = await getFile(file)
    const beforeBytes = entry.counter.bytes
    const beforeRequests = entry.counter.requests
    const rows = await parquetReadObjects({
      file: entry.buffer,
      metadata: entry.metadata,
      columns,
      rowStart,
      rowEnd,
    })
    out.bytesFetched += footerBytes + (entry.counter.bytes - beforeBytes)
    out.requests += footerRequests + (entry.counter.requests - beforeRequests)
    out.filesTouched++

    const groups = rowGroupsFor(entry.metadata, rowStart, rowEnd)
    out.rowGroupsTotal += groups.total
    out.rowGroupsRead += groups.read
    if (out.firstRowGroup < 0) out.firstRowGroup = groups.first
    out.lastRowGroup = groups.last

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
