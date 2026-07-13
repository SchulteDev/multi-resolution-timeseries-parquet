# multi-resolution-timeseries-parquet

**Serve years of high-frequency time-series to a browser chart — no backend, no database. Just multi-resolution Parquet tiers and HTTP range requests.**

[**▶ Live demo**](https://schultedev.github.io/multi-resolution-timeseries-parquet/)

Raw data is 1-minute OHLC bars. Five years is ~2.6M rows per series — tens of megabytes, too slow to drop into a browser. Parquet can skip row groups and project columns, but it **cannot aggregate**: "weekly candles" is a `GROUP BY`, which needs a query engine, and even then it must scan every underlying row.

So we move the aggregation to the **write path**. Precompute resolution tiers — mipmaps, but for time — and the frontend only ever reads small, already-shaped files. It picks the tier matching the visible span and fetches just the rows (and columns) in view over HTTP range requests.

```
generator (Node/TypeScript)
  synthetic 1-min OHLC  →  cascade rollup  →  tiers: 1min · 15min · 1h · 1d
                                                 ↓  Parquet (snappy, row-group stats),
                                                    1min partitioned by month + manifest.json
        static hosting (GitHub Pages demo · Azure Blob in prod)
                                                 ↓
frontend (hyparquet + uPlot, ~39 KB gzipped)
  selects tier by visible span  →  asyncBufferFromUrl (HTTP range requests)
  reads only the needed row range + columns  →  renders candlesticks
```

## Why it works — the numbers

Zooming the live chart, the on-screen counter shows bytes actually fetched (every request is a `206 Partial Content`):

| View | Tier | Rows drawn | Bytes fetched |
|---|---|---|---|
| Full 5 years | `1d` | 1,827 | **~61 KB** |
| ~2 months | `1h` | 2,881 | ~245 KB |
| ~5 days | `15min` | 961 | ~238 KB |
| ~6 hours — candles (5 cols) | `1min` | 721 | ~218 KB |
| ~6 hours — line (`close` only) | `1min` | 721 | **~94 KB** |

The full 1-min tier is **~53 MB** on disk. Two independent Parquet features are visible in that table:

- **Tiering** — see all five years for ~61 KB instead of 53 MB (~900×), because you read the pre-aggregated daily tier, not the raw minutes.
- **Column projection** — Parquet is columnar, so switching candles → line drops O/H/L and fetches ~2.3× fewer bytes for the same rows.

## Key design decisions

- **OHLC per bucket, not mean.** This is market data — a plain average destroys the highs and lows. Each tier preserves open/high/low/close so candles survive downsampling.
- **OHLC composes, so tiers cascade.** `open=first, high=max, low=min, close=last` combine correctly across bucket merges (OHLC is a monoid). Coarser tiers are built from the next-finer tier (1min→15min→1h→1d), not by re-scanning the raw data — and the result is provably identical to a direct rollup (enforced by a test). A mean would *not* compose.
- **hyparquet, not DuckDB-WASM.** DuckDB-WASM's value is ad-hoc SQL in the browser — the exact thing we avoid, since aggregating years of 1-min data on every zoom means scanning millions of rows. Once data is pre-aggregated, a multi-MB WASM binary buys nothing. hyparquet is pure JS, tiny, and purpose-built to read Parquet over HTTP range requests.
- **snappy, so the read path stays dependency-free.** Tiers are written snappy, which hyparquet decodes natively — no `hyparquet-compressors`.
- **Sort by timestamp; tune row-group size.** Row-group min/max stats only enable skipping if data is time-ordered. The default ~128 MB row group is far too coarse for ranged reads, so tiers use ~10k-row groups for fine skip granularity.
- **Partition by time, not one giant file.** The 1-min tier is split into monthly files (~900 KB each) so any single footer stays tiny; coarser tiers are single files. The frontend picks files from `manifest.json`, never by naming convention.
- **`BASE_URL` is one config value.** Local ↔ GitHub Pages ↔ Azure Blob is a one-line switch (`VITE_BASE`).

## Run it locally

```bash
npm install
npm run generate   # synthesize 5y of 1-min bars and build all tiers into public/data (~3s, ~53 MB)
npm run dev        # open the printed localhost URL
```

Other scripts:

```bash
npm test           # vitest — rollup/OHLC-composition, tier selection, bucket math, write↔read round-trip
npm run build      # tsc typecheck + vite production build into dist/
```

## Project layout

```
shared/            pure logic shared by build + frontend (tested in isolation)
  time.ts            resolution ladder + bucket math
  ohlc.ts            OHLC series type + cascade rollup
  tierSelect.ts      visible span → tier
  manifest.ts        manifest types + file selection
scripts/           write path (run with tsx)
  generate.ts        synth → cascade → write tiers + manifest
  lib/               synth (seeded GBM) · writeTier (hyparquet-writer) · partition
src/               frontend
  main.ts            controller: zoom → tier → load → render
  dataLoader.ts      counting AsyncBuffer, cached footers, projected row-range reads
  chart.ts           uPlot options + custom candlestick renderer
  manifest.ts, ui.ts
test/              vitest suite
```

## How the write path builds tiers

`npm run generate`:

1. **Synthesize** ~2.6M 1-min OHLC bars (2020–2025, 24/7) with a seeded geometric random walk — deterministic, so CI output is reproducible.
2. **Cascade** the rollup: 1min→15min→1h→1d, each level built from the previous one.
3. **Write** Parquet with `hyparquet-writer`: snappy, `statistics: true` (min/max per row group), `rowGroupSize: 10000`. The 1-min tier is partitioned by month; coarser tiers are single files.
4. **Emit `manifest.json`** — every tier and file indexed by `[start, end]`, `rows`, and `bytes` (so the reader skips a HEAD request).

Tune tiers, row-group size, and the partition scheme in `shared/time.ts` and `scripts/`.

## How the read path selects data

On every zoom (`src/main.ts` + `shared/tierSelect.ts`):

1. **Pick the tier** — the finest resolution whose bucket count stays under a cap (~3,000), holding points-on-screen roughly constant.
2. **Pick the files** — those overlapping the visible span (plus a margin, so panning within it costs no request).
3. **Compute the row range arithmetically** — because the data is gapless and regular, `rowStart/rowEnd` come from `(t − fileStart) / bucketMs`, no value scan. hyparquet then fetches only the row groups overlapping that range.
4. **Project columns** — candles read O/H/L/C; line reads only `close`.

Footers are read once (16 KB, since ours are ~0.5–7 KB — far below hyparquet's 512 KB default) and cached; a `slice`-counting wrapper reports bytes fetched so the savings are visible.

## Derived resolutions — not every resolution needs a tier

The **Resolution** picker offers `Auto` (zoom-driven stored tiers) plus explicit resolutions, including **2 min ✷ / 5 min ✷ / 4 hours ✷** that have *no stored Parquet tier*. These are **resampled in the browser** from the nearest finer stored tier — 2/5 min from `1min`, 4 h from `1h` — using the **same `rollup()` that builds the tiers on the write path**. OHLC composes, so the result is identical to a stored tier would be; the aggregation just runs wherever it's cheapest.

This shows the honest boundary of the whole approach:

- **Where it works:** while the source read stays bounded, deriving a resolution client-side is free — no extra tier to generate, store, or compact. Pick `5 min` zoomed into a few days and the stats show e.g. *11,521 `1min` rows read → 2,305 `5 min` bars* drawn.
- **Where it doesn't:** pick a ✷ resolution zoomed way out and it refuses — *"5 min would resample ~446,400 1min rows here — too wide, showing 1 day instead"* — and falls back to auto tiering. That refusal **is** the argument for precomputed tiers: past a read budget (`MAX_SOURCE_ROWS`), you precompute.

So the demo argues both directions: precompute the coarse tiers that would otherwise scan millions of rows, and resample the in-between resolutions on the fly when the window is small enough.

## Deploy to GitHub Pages

The included workflow (`.github/workflows/deploy.yml`) runs on push to `main`:

1. **`test`** — `npm run build` (typecheck + bundle) and `npm test`. This gates everything; a breaking dependency bump (Renovate) fails here before it can ship.
2. **`deploy`** — `npm run generate` (tiers are built in CI, never committed), `npm run build` with `VITE_BASE` set to the project sub-path, then upload + deploy to Pages.

One-time setup: **Settings → Pages → Source: GitHub Actions**. GitHub Pages serves over Fastly with `Accept-Ranges: bytes`, same-origin — no CORS to configure. Pages' 100 MB per-file limit is trivially satisfied (the coarse tiers are tiny; monthly 1-min files are ~900 KB).

## Azure Blob Storage (production)

The frontend is just `fetch` + range requests, so it runs on any static host. Two things differ on Azure Blob; set `VITE_BASE` to the container/CDN URL and mind:

- **CORS is the #1 thing that silently breaks this.** It works in `curl` but fails in the browser unless the container's CORS rules **allow the `Range` request header** and **expose `Content-Range` and `Accept-Ranges`**. Without that, range requests fall back to full-file downloads (or fail), defeating the whole design.
- **Auth: never account keys in the browser.** Use a **public (read-only) container**, or a **read-only, time-limited SAS token** appended to the URL. Account keys grant full write/delete and must never reach client code.

## Known limitations (honest)

- **Parquet is immutable.** Appending means new files (many small files hurt reads) or periodic rewrite/compaction. The compaction job is where people underestimate the effort.
- **No transactions.** Late/out-of-order data and corrections get fiddly on raw Parquet. The natural upgrade — *if this becomes painful* — is **Delta Lake / Iceberg on the same blob storage** (ACID appends, compaction, time-travel), not jumping to a database.
- **Fixed, pre-computed resolutions only.** This serves known chart resolutions, not arbitrary queries. **Azure Data Explorer / Elasticsearch are the wrong reach** here — only justified if a genuine ad-hoc query requirement appears (e.g. a research/backtesting UI).

## License

MIT
