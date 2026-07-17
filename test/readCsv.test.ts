import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCsv } from '../scripts/lib/readCsv'
import { CSV_HEADER } from '../scripts/lib/config'

const tmp = mkdtempSync(join(tmpdir(), 'mrtp-'))
function fixture(name: string, body: string): string {
  const p = join(tmp, name)
  writeFileSync(p, body)
  return p
}

describe('readCsv', () => {
  it('parses values, not strings, keeping every column row-aligned', async () => {
    const p = fixture('ok.csv', `${CSV_HEADER}\n1000,1.5,2.5,0.5,2\n61000,2,3,1,2.25\n`)
    const s = await readCsv(p)
    expect(s.ts).toEqual([1000, 61_000])
    expect(s.open).toEqual([1.5, 2])
    expect(s.high).toEqual([2.5, 3])
    expect(s.low).toEqual([0.5, 1])
    expect(s.close).toEqual([2, 2.25])
  })

  it('rejects a wrong header', async () => {
    const p = fixture('bad-header.csv', 'time,o,h,l,c\n1000,1,2,0,1\n')
    await expect(readCsv(p)).rejects.toThrow(/expected header/)
  })

  it('rejects non-ascending timestamps', async () => {
    // Tier math and row-range arithmetic both assume sorted input.
    const p = fixture('unsorted.csv', `${CSV_HEADER}\n61000,1,2,0,1\n1000,1,2,0,1\n`)
    await expect(readCsv(p)).rejects.toThrow(/must ascend/)
  })

  it('rejects a bad timestamp', async () => {
    const p = fixture('bad-ts.csv', `${CSV_HEADER}\nnope,1,2,0,1\n`)
    await expect(readCsv(p)).rejects.toThrow(/bad timestamp/)
  })

  it('rejects a file with no data rows', async () => {
    const p = fixture('empty.csv', `${CSV_HEADER}\n`)
    await expect(readCsv(p)).rejects.toThrow(/no data rows/)
  })
})
