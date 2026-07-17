import { existsSync, rmSync } from 'node:fs'
import { relative } from 'node:path'
import { OUT_DIR } from './lib/config'

// Delete generated output so `npm run generate` starts from a clean slate.
//
// No rimraf needed: recursive+force delete has been built into Node since
// 14.14 (`fs.rmSync`), which is what rimraf now points people at anyway.
//
// data/raw is deliberately NOT touched — the raw CSV is the pipeline's input,
// not a build artifact, and re-seeding it takes ~3 minutes.
const TARGETS = [
  OUT_DIR, // public/data — the generated Parquet tiers + manifest
  'dist', // vite build output
]

for (const target of TARGETS) {
  const existed = existsSync(target)
  rmSync(target, { recursive: true, force: true })
  const shown = relative(process.cwd(), target).split('\\').join('/')
  console.log(`  ${existed ? 'removed' : 'absent '}  ${shown}`)
}

console.log('\nKept data/raw (the pipeline input). Next: npm run generate')
