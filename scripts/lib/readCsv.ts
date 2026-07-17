import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { emptySeries, type Series } from '../../shared/ohlc'
import { CSV_HEADER } from './config'

/**
 * Read a raw OHLC CSV (optionally gzipped) into a Series.
 *
 * This is the pipeline's only input. The file is streamed and parsed line by
 * line so the ~105 MB of raw text never lands in memory at once — only the
 * parsed columns do. Rows must be timestamp-ascending, which the tiering and
 * the frontend's arithmetic row-indexing both rely on.
 */
export async function readCsv(path: string): Promise<Series> {
  const stream = path.endsWith('.gz')
    ? createReadStream(path).pipe(createGunzip())
    : createReadStream(path)
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  const s = emptySeries()
  let lineNo = 0
  let prevTs = -Infinity

  for await (const line of rl) {
    lineNo++
    if (lineNo === 1) {
      const header = line.trim()
      if (header !== CSV_HEADER) {
        throw new Error(`${path}: expected header "${CSV_HEADER}", got "${header}"`)
      }
      continue
    }
    if (!line) continue

    const [ts, open, high, low, close] = line.split(',')
    const t = Number(ts)
    if (!Number.isFinite(t)) throw new Error(`${path}:${lineNo}: bad timestamp "${ts}"`)
    if (t <= prevTs) throw new Error(`${path}:${lineNo}: timestamps must ascend (${t} after ${prevTs})`)
    prevTs = t

    s.ts.push(t)
    s.open.push(Number(open))
    s.high.push(Number(high))
    s.low.push(Number(low))
    s.close.push(Number(close))
  }

  if (s.ts.length === 0) throw new Error(`${path}: no data rows`)
  return s
}
