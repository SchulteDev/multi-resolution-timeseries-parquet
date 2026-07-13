import { parquetWriteBuffer } from 'hyparquet-writer'
import type { Series } from '../../shared/ohlc'

// Row-group size in ROWS (not bytes). The Parquet default (~128 MB) is far too
// coarse for ranged frontend reads: a smaller row group is the unit of
// skip-granularity, so the reader can fetch just the groups overlapping the
// visible range. ~10k rows keeps a monthly 1-min file at ~4-5 groups.
const ROW_GROUP_SIZE = 10_000

/**
 * Serialize an OHLC series to a Parquet buffer.
 *
 * - `ts` is stored as INT64 epoch ms (BigInt on the wire), sorted ascending so
 *   row-group min/max stats are monotonic and enable skipping.
 * - OHLC are DOUBLE.
 * - `statistics: true` writes the per-column min/max the reader needs to skip
 *   row groups. Codec defaults to SNAPPY, which hyparquet decodes natively (no
 *   hyparquet-compressors dependency on the read path).
 */
export function serializeTier(series: Series): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: 'ts', data: series.ts.map(BigInt), type: 'INT64' },
      { name: 'open', data: series.open, type: 'DOUBLE' },
      { name: 'high', data: series.high, type: 'DOUBLE' },
      { name: 'low', data: series.low, type: 'DOUBLE' },
      { name: 'close', data: series.close, type: 'DOUBLE' },
    ],
    statistics: true,
    rowGroupSize: ROW_GROUP_SIZE,
  })
}
