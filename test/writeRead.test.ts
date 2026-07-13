import { describe, it, expect } from 'vitest'
import { parquetReadObjects, parquetMetadataAsync } from 'hyparquet'
import { serializeTier } from '../scripts/lib/writeTier'
import type { Series } from '../shared/ohlc'

// End-to-end guard across the writer <-> reader boundary. This is the test that
// catches a breaking `hyparquet` or `hyparquet-writer` version bump (Renovate)
// before it can ship: it asserts round-trip fidelity, column projection, and
// that row-group statistics are actually written.
const series: Series = {
  ts: [0, 60_000, 120_000, 180_000],
  open: [10, 11, 12, 13],
  high: [15, 16, 17, 18],
  low: [9, 10, 11, 12],
  close: [11, 12, 13, 14],
}

describe('parquet write -> read round trip', () => {
  it('reads back identical OHLC values', async () => {
    const file = serializeTier(series)
    const rows = await parquetReadObjects({ file })
    expect(rows).toHaveLength(4)
    expect(Number(rows[0].ts)).toBe(0)
    expect(rows[0].open).toBe(10)
    expect(rows[3].close).toBe(14)
  })

  it('projects a subset of columns (fewer columns fetched)', async () => {
    const file = serializeTier(series)
    const rows = await parquetReadObjects({ file, columns: ['ts', 'close'] })
    expect(Object.keys(rows[0]).sort()).toEqual(['close', 'ts'])
    expect(rows.map((r) => r.close)).toEqual([11, 12, 13, 14])
  })

  it('supports arithmetic row-range reads', async () => {
    const file = serializeTier(series)
    const rows = await parquetReadObjects({ file, rowStart: 1, rowEnd: 3 })
    expect(rows.map((r) => Number(r.ts))).toEqual([60_000, 120_000])
  })

  it('writes per-column min/max statistics that enable row-group skipping', async () => {
    const file = serializeTier(series)
    const meta = await parquetMetadataAsync(file)
    const tsCol = meta.row_groups[0].columns.find(
      (c) => c.meta_data?.path_in_schema.join('.') === 'ts',
    )
    expect(tsCol?.meta_data?.statistics).toBeDefined()
  })
})
