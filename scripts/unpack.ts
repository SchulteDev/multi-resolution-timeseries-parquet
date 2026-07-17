import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { RAW_CSV_PATH } from './lib/config'

// Unpack the committed raw CSV for inspection — handy when showing what the
// pipeline actually reads. The result is gitignored: at ~105 MB it exceeds
// GitHub's 100 MB per-file limit, which is why the repo ships the .gz.
//
// (It's a plain gzip stream, not a tar archive — `tar -x` on it will happily
// treat each CSV line as a filename. Use this script, or `gunzip -c`.)
const OUT = RAW_CSV_PATH.replace(/\.gz$/, '')

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`

console.log(`Unpacking ${RAW_CSV_PATH}`)
await pipeline(createReadStream(RAW_CSV_PATH), createGunzip(), createWriteStream(OUT))

const gz = statSync(RAW_CSV_PATH).size
const raw = statSync(OUT).size
console.log(`  ${mb(gz)} -> ${mb(raw)}  (${(raw / gz).toFixed(1)}x)`)
console.log(`\nWrote ${OUT}`)
console.log('This file is gitignored — inspect it with e.g. `head data/raw/1min.csv`.')
