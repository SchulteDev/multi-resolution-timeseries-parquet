# multi-resolution-timeseries-parquet

[![Build](https://github.com/SchulteDev/multi-resolution-timeseries-parquet/actions/workflows/deploy.yml/badge.svg)](https://github.com/SchulteDev/multi-resolution-timeseries-parquet/actions/workflows/deploy.yml)
[![Renovate](https://img.shields.io/badge/renovate-enabled-brightgreen?logo=renovatebot)](https://developer.mend.io/github/SchulteDev/multi-resolution-timeseries-parquet)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

**Serve years of high-frequency time-series to a browser chart — no backend, no database. Multi-resolution Parquet tiers + HTTP range requests.**

[**▶ Live demo**](https://schultedev.github.io/multi-resolution-timeseries-parquet/)

5 years of 1-minute OHLC bars = 2.6M rows = a 105 MB CSV. Parquet skips row groups and projects columns, but it cannot aggregate: "weekly candles" is a `GROUP BY`, which needs a query engine and still scans every underlying row.

So aggregation happens at **write** time. Precompute tiers at fixed resolutions; the frontend reads only the tier, rows and columns currently in view.

```
data/raw/1min.csv.gz          committed input — 105 MB CSV, 26 MB gzipped
      │  npm run generate     parse CSV → cascade rollup → write Parquet
      ▼
public/data/
  1min/all.parquet   52.6 MB  264 row groups, 96 KB footer
  15min/all.parquet   3.8 MB
  1h/all.parquet      1.0 MB
  1d/all.parquet       46 KB
  manifest.json               tier index: time bounds, rows, file + footer sizes
      │  static hosting (GitHub Pages)
      ▼
src/query.ts (~80 lines)      pick tier → time window to row range → footer stats
                              skip row groups → read only needed columns via HTTP
                              Range → render (uPlot)
```

## Numbers

The demo shows the query and its execution plan under the chart. Against the single 52.6 MB `1min` file:

| View | Row groups | Columns | Bytes fetched |
|---|---|---|---|
| Full 5 years (`1d` tier) | 1 of 1 | 5 of 5 | **45 KB** |
| 6 hours, candles (`1min`) | **1 of 264** | 5 of 5 | **303 KB · 0.56%** of the file |
| 6 hours, line (`1min`) | 1 of 264 | **2 of 5** | **96 KB · 0.18%**, 2 range requests |
| 6 hours, `5min ✷` derived | 1 of 264 | 5 of 5 | 207 KB, resampled 726 rows → 146 bars |

Three mechanisms, each a line in the plan panel:

- **Tiering** — 5 years costs 45 KB because it reads the daily tier, not the raw minutes.
- **Row-group skipping** — the footer's per-group min/max stats mean a 6-hour window touches 1 of 264 row groups. No partitioning: the footer is the index.
- **Column projection** — candles → line drops O/H/L and fetches ~3× fewer bytes.

## Run it

Needs Node 24.

```bash
npm install
npm run generate   # data/raw/1min.csv.gz -> public/data/*.parquet + manifest (~10s)
npm run dev
```

| script | what |
|---|---|
| `npm test` | rollup/OHLC composition, tier selection, CSV parsing, row-range math, write↔read round-trip |
| `npm run build` | `tsc --noEmit` + vite build into `dist/` |
| `npm run unpack` | gunzip the raw CSV to `data/raw/1min.csv` (105 MB) to inspect it. It's a gzip stream, not a tar archive. The result is gitignored — 105 MB exceeds GitHub's 100 MB file limit, hence the `.gz`. |
| `npm run reset` | delete `public/data` + `dist`; keeps `data/raw` |
| `npm run seed` | regenerate the raw CSV itself (~3 min, deterministic) |

## How a query is answered

All in [`src/query.ts`](src/query.ts):

1. **Pick the resolution** — finest tier whose bucket count stays under ~3,000, holding points-on-screen roughly constant. A resolution with no stored tier (2min/5min/4h) reads the nearest finer tier.
2. **Time window → row range** — data is gapless and regular, so `rowStart/rowEnd = (t − fileStart) / bucketMs`. No scan, no index lookup.
3. **Skip row groups** — hyparquet reads only the groups overlapping that row range, via the footer's min/max stats.
4. **Project columns** — candles read O/H/L/C, line reads only `close`. Unread column chunks are never fetched.
5. **Resample if derived** — the same `rollup()` that built the tiers, in the browser.

The only literal `fetch()` in the frontend is the manifest ([`src/manifest.ts`](src/manifest.ts)). Every Parquet byte goes through `slice(start, end)` in [`src/dataLoader.ts`](src/dataLoader.ts) — one call = one `Range` request. The wrapper around it counts bytes and requests for the plan panel.

## Derived resolutions

`2min ✷ / 5min ✷ / 4h ✷` have no stored tier. They're resampled in the browser from the nearest finer tier (2/5min from `1min`, 4h from `1h`) with the same `rollup()` as the write path. OHLC composes, so the result equals a stored tier.

Bounded by `MAX_SOURCE_ROWS` (20,000): pick a `✷` resolution zoomed too far out and it refuses — *"5 min would need ~446,400 1min rows for this window"* — and falls back to a stored tier. That threshold is where precomputing starts paying.

## Layout

```
data/raw/1min.csv.gz     committed pipeline input
shared/                  pure logic, shared by build + frontend, unit-tested
  time.ts                  resolution ladder + bucket math
  ohlc.ts                  Series type + cascade rollup (used on BOTH sides)
  tierSelect.ts            visible span → tier
  manifest.ts              manifest types, file selection, row-range arithmetic
  renderResolutions.ts     stored vs derived resolutions + resample budget
scripts/                 write path (tsx)
  seed.ts                  one-time: synthesize the raw CSV; not part of the build
  generate.ts              the pipeline: CSV → cascade → Parquet tiers + manifest
  lib/                     config · readCsv · writeTier (hyparquet-writer)
src/                     frontend
  query.ts                 the query engine — start here
  dataLoader.ts            counting AsyncBuffer, cached footers, ranged reads
  main.ts                  controller: zoom → query → render
  chart.ts                 uPlot options, candlestick renderer, pan/wheel plugins
  manifest.ts, ui.ts       manifest fetch · query + plan panel
test/                    vitest suite
```

## Design notes

- **The CSV is the input; the build only transforms it.** `npm run generate` invents nothing — point it at your own CSV with these columns:
  ```csv
  ts,open,high,low,close
  1577836800000,100.00,100.00,99.57,99.57
  ```
  (`scripts/seed.ts` is how this demo's CSV was fabricated. One-time, not part of the build.)
- **OHLC per bucket, not mean.** An average destroys the highs and lows.
- **OHLC composes, so tiers cascade.** `open=first, high=max, low=min, close=last` merge correctly, so coarser tiers are built from the next-finer tier (1min→15min→1h→1d), not from the raw data. Identical to a direct rollup — enforced by a test. A mean would not compose.
- **One file per tier**, including the 52.6 MB one. Not production practice (see limitations); with partitions, part of the win is just picking the right file, and this way all of it is Parquet's own machinery.
- **Row-group size is the tradeoff.** ~10k rows/group ⇒ 264 groups ⇒ a 96 KB footer over 52.6 MB. Smaller groups = finer skipping, fatter footer. Read once, then cached.
- **The manifest carries exact file and footer sizes**, so metadata costs one minimal range request — no HEAD, no guessing (hyparquet defaults to fetching the last 512 KB).
- **Snappy**, which hyparquet decodes natively — no `hyparquet-compressors` on the read path.

## Deploy

`.github/workflows/deploy.yml` on push to `main`:

1. **`test`** — `npm run build` + `npm test`. Gates everything, so a breaking dependency bump (Renovate) fails before it ships.
2. **`deploy`** — `npm run generate` (tiers built in CI from the committed CSV, never committed), `npm run build` with `VITE_BASE` set to the project sub-path, upload + deploy to Pages.

One-time: **Settings → Pages → Source: GitHub Actions**.

Any static host works if it serves HTTP `Range` requests and, cross-origin, exposes `Content-Range` / `Accept-Ranges`. Pages does, same-origin. `VITE_BASE` is the only thing to change.

## Limitations

- **One file per tier is a demo choice.** Real ingestion appends, and Parquet is immutable: you'd write new files per period, partition by time, and run a compaction job to merge small files. Footers also grow linearly — 52.6 MB already needs 96 KB.
- **No transactions.** Late/out-of-order data and corrections get fiddly. The upgrade is Delta Lake / Iceberg on the same storage (ACID appends, compaction, time-travel), not a database.
- **Fixed, precomputed resolutions**, not ad-hoc queries.
- **26 MB of gzipped CSV in git** is a self-contained-demo tradeoff. At real scale the raw data lives in object storage and only the tiers ship.
