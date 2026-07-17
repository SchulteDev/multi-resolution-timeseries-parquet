# multi-resolution-timeseries-parquet

**Serve years of high-frequency time-series to a browser chart — no backend, no database. Just multi-resolution Parquet tiers and HTTP range requests.**

[**▶ Live demo**](https://schultedev.github.io/multi-resolution-timeseries-parquet/)

Raw data is 1-minute OHLC bars. Five years is ~2.6M rows per series — a **105 MB CSV**, too slow to drop into a browser. Parquet can skip row groups and project columns, but it **cannot aggregate**: "weekly candles" is a `GROUP BY`, which needs a query engine, and even then it must scan every underlying row.

So we move the aggregation to the **write path**. Precompute resolution tiers — mipmaps, but for time — and the frontend only ever reads small, already-shaped slices. It picks the tier matching the visible span and fetches just the rows (and columns) in view over HTTP range requests.

```
data/raw/1min.csv.gz        ← committed: the pipeline's input (105 MB CSV, 26 MB gzipped)
        ↓  npm run generate — the pipeline: parse CSV → cascade rollup → write Parquet
public/data/
  1min/all.parquet   52.6 MB   264 row groups
  15min/all.parquet   3.8 MB
  1h/all.parquet      1.0 MB
  1d/all.parquet       46 KB
  manifest.json      ← tier/file index: time bounds, row counts, file + footer sizes
        ↓  static hosting (GitHub Pages demo · Azure Blob in prod)
frontend (hyparquet + uPlot, ~40 KB gzipped)
  query() → pick tier → time window to row range → footer stats skip row groups
          → read only the needed columns via HTTP Range → render
```

**The query engine is ~80 lines of TypeScript** ([`src/query.ts`](src/query.ts)) — no SQL, no WASM, no database.

## Why it works — the numbers

The live demo shows the query and its execution plan under the chart, always. Zooming to a 6-hour window at 1-minute resolution, against the **single 52.6 MB** Parquet file:

| View | Row groups | Columns | Bytes fetched |
|---|---|---|---|
| Full 5 years (`1d` tier) | 1 of 1 | 5 of 5 | **45 KB** |
| 6 hours, candles (`1min`) | **1 of 264** — 263 skipped | 5 of 5 | **303 KB · 0.56%** of the file |
| 6 hours, line (`1min`) | 1 of 264 | **2 of 5** | **96 KB · 0.18%** — 2 range requests |
| 6 hours, `5min ✷` (derived) | 1 of 264 | 5 of 5 | 207 KB — *726 rows → 146 bars resampled in-browser* |

Three independent mechanisms, all visible in the plan panel:

- **Tiering** — see all five years for 45 KB instead of 52.6 MB, because you read the pre-aggregated daily tier, not the raw minutes.
- **Row-group skipping** — the footer's per-group min/max stats mean a 6-hour window touches **1 of 264 row groups**. No partitioning, no naming convention: the footer *is* the index.
- **Column projection** — Parquet is columnar, so candles → line drops O/H/L and fetches ~3× fewer bytes for the same rows.

## Key design decisions

- **The raw CSV is committed; the build only transforms it.** `data/raw/1min.csv.gz` is the pipeline's input — you can `gunzip -c … | head` it, and [`data/sample/1min-sample.csv`](data/sample/1min-sample.csv) shows the format in plain text. `npm run generate` invents nothing; point it at your own CSV with the same columns and it works unchanged. (`scripts/seed.ts` is how *this* demo's CSV was fabricated — a one-time provenance step, deliberately not part of the build.)
- **OHLC per bucket, not mean.** This is market data — a plain average destroys the highs and lows. Each tier preserves open/high/low/close so candles survive downsampling.
- **OHLC composes, so tiers cascade.** `open=first, high=max, low=min, close=last` combine correctly across bucket merges (OHLC is a monoid). Coarser tiers are built from the next-finer tier (1min→15min→1h→1d), not by re-scanning the raw data — and the result is provably identical to a direct rollup (enforced by a test). A mean would *not* compose. The same `rollup()` also runs in the browser for derived resolutions.
- **One file per tier — even the 52.6 MB one.** This is deliberately *not* production practice (see limitations), but it makes the demo honest: with monthly partitions, part of the win comes from picking the right file, which is just a manifest lookup. With a single file, **100% of the win is Parquet's own machinery** — footer, row-group stats, column chunks, range requests.
- **Row-group size is a real tradeoff here.** ~10k rows/group ⇒ 264 groups ⇒ a **96 KB footer** over a 52.6 MB file. Smaller groups = finer skipping, fatter footer. Partitioning used to hide this; one big file makes it visible. The footer is read **once** and cached.
- **The manifest carries exact file and footer sizes**, so the metadata read costs exactly one minimal range request — no HEAD, no guessing (hyparquet's default would grab the last 512 KB).
- **hyparquet, not DuckDB-WASM.** DuckDB-WASM's value is ad-hoc SQL in the browser — the exact thing we avoid, since aggregating years of 1-min data on every zoom means scanning millions of rows. Once data is pre-aggregated, a multi-MB WASM binary buys nothing.
- **snappy, so the read path stays dependency-free.** Tiers are written snappy, which hyparquet decodes natively — no `hyparquet-compressors`.
- **`BASE_URL` is one config value.** Local ↔ GitHub Pages ↔ Azure Blob is a one-line switch (`VITE_BASE`).

## Run it locally

```bash
npm install
npm run generate   # data/raw/1min.csv.gz -> public/data/*.parquet + manifest (~10s)
npm run dev        # open the printed localhost URL
```

`npm run seed` regenerates the raw CSV itself (~3 min, deterministic) — only needed if you want to change the synthetic dataset. Other scripts:

```bash
npm test           # vitest — rollup/OHLC-composition, tier selection, CSV parsing, row-range math, write↔read round-trip
npm run build      # tsc typecheck + vite production build into dist/
npm run unpack     # gunzip data/raw/1min.csv.gz -> data/raw/1min.csv (105 MB) to inspect the raw input
npm run reset      # delete generated output (public/data + dist); keeps data/raw, so `npm run generate` starts clean
```

> `data/raw/1min.csv.gz` is a plain **gzip** stream, not a tar archive — `tar -x` on it will treat every CSV line as a filename. Use `npm run unpack` (or `gunzip -c`). The unpacked CSV is gitignored: at 105 MB it exceeds GitHub's 100 MB per-file limit, which is why the repo ships the 26 MB `.gz`.

## Project layout

```
data/
  raw/1min.csv.gz        committed — the pipeline's input (105 MB CSV, 26 MB gzipped)
  sample/1min-sample.csv committed — 200 rows, readable on GitHub; test fixture
shared/                  pure logic shared by build + frontend (tested in isolation)
  time.ts                  resolution ladder + bucket math
  ohlc.ts                  OHLC series type + cascade rollup (used on BOTH sides)
  tierSelect.ts            visible span → tier
  manifest.ts              manifest types, file selection, row-range arithmetic
  renderResolutions.ts     stored vs derived resolutions + the resample budget
scripts/                 write path (run with tsx)
  seed.ts                  one-time: synthesize the raw CSV (provenance, not the build)
  generate.ts              the pipeline: CSV → cascade → Parquet tiers + manifest
  lib/                     config · readCsv · writeTier (hyparquet-writer)
src/                     frontend
  query.ts                 THE query engine (~80 lines) — start here
  dataLoader.ts            counting AsyncBuffer, cached footers, projected row-range reads
  main.ts                  controller: zoom → query → render
  chart.ts                 uPlot options, candlestick renderer, pan/wheel plugins
  manifest.ts, ui.ts       manifest fetch · query + plan panel
test/                    vitest suite
```

## How a query is answered

All of it lives in [`src/query.ts`](src/query.ts):

1. **Pick the resolution** — the finest tier whose bucket count stays under a cap (~3,000), holding points-on-screen roughly constant. A resolution with no stored tier (2min/5min/4h) reads the nearest finer tier instead.
2. **Time window → row range, by arithmetic** — the data is gapless and regular, so `rowStart/rowEnd = (t − fileStart) / bucketMs`. No value scan, no index lookup.
3. **Row groups skip themselves** — hyparquet reads only the groups overlapping that row range, using the footer's min/max stats. The plan panel reports how many were skipped.
4. **Project columns** — candles read O/H/L/C; line reads only `close`. Unread column chunks are never fetched.
5. **Resample if derived** — the same `rollup()` that built the tiers, running in the browser.

Steps 2–4 are the only reason this works without a backend, and each one is a line in the plan panel.

## Derived resolutions — not every resolution needs a tier

The **Resolution** picker offers `Auto` (zoom-driven stored tiers) plus explicit resolutions, including **2 min ✷ / 5 min ✷ / 4 hours ✷** that have *no stored Parquet tier*. They're **resampled in the browser** from the nearest finer stored tier — 2/5 min from `1min`, 4 h from `1h` — using the same `rollup()` as the write path. OHLC composes, so the result is identical to a stored tier; the aggregation just runs wherever it's cheapest.

This shows the honest boundary of the whole approach:

- **Where it works:** while the source read stays bounded, deriving a resolution client-side is free — no extra tier to generate, store, or compact.
- **Where it doesn't:** pick a ✷ resolution zoomed way out and it refuses — *"5 min would need ~446,400 1min rows for this window — too wide to resample"* — and falls back to a precomputed tier. That refusal **is** the argument for tiers: past a read budget (`MAX_SOURCE_ROWS`), you precompute.

So the demo argues both directions: precompute the coarse tiers that would otherwise scan millions of rows, and resample the in-between resolutions on the fly when the window is small enough.

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` runs on push to `main`:

1. **`test`** — `npm run build` (typecheck + bundle) and `npm test`. This gates everything; a breaking dependency bump (Renovate) fails here before it can ship.
2. **`deploy`** — `npm run generate` (tiers are built in CI from the committed CSV, never committed themselves), `npm run build` with `VITE_BASE` set to the project sub-path, then upload + deploy to Pages.

One-time setup: **Settings → Pages → Source: GitHub Actions**. Pages serves over Fastly with `Accept-Ranges: bytes`, same-origin — no CORS to configure. The 100 MB per-file limit is satisfied (the 1-min tier is 52.6 MB).

## Azure Blob Storage (production)

The frontend is just `fetch` + range requests, so it runs on any static host. Two things differ on Azure Blob; set `VITE_BASE` to the container/CDN URL and mind:

- **CORS is the #1 thing that silently breaks this.** It works in `curl` but fails in the browser unless the container's CORS rules **allow the `Range` request header** and **expose `Content-Range` and `Accept-Ranges`**. Without that, range requests fall back to full-file downloads (or fail), defeating the whole design.
- **Auth: never account keys in the browser.** Use a **public (read-only) container**, or a **read-only, time-limited SAS token** appended to the URL. Account keys grant full write/delete and must never reach client code.

## Known limitations (honest)

- **One file per tier is a demo choice, not production practice.** Real ingestion appends, and Parquet is immutable — so you'd write new files per period (hourly/daily), which means **partitioning by time** and a **compaction job** to merge the resulting small files back into well-sized ones. That compaction job is where people underestimate the effort. Partitioning also keeps any single footer small: our 52.6 MB file needs a 96 KB footer, and that grows linearly with the data. We use one file because it makes the row-group skipping visible; you should partition.
- **No transactions.** Late/out-of-order data and corrections get fiddly on raw Parquet. The natural upgrade — *if this becomes painful* — is **Delta Lake / Iceberg on the same blob storage** (ACID appends, compaction, time-travel), not jumping to a database.
- **Fixed, pre-computed resolutions only.** This serves known chart resolutions, not arbitrary queries. **Azure Data Explorer / Elasticsearch are the wrong reach** here — only justified if a genuine ad-hoc query requirement appears (e.g. a research/backtesting UI).
- **Raw high-frequency data doesn't belong in git.** We commit 26 MB of gzipped CSV because a self-contained demo is worth it. At real scale the raw source lives in object storage and only the derived tiers ship.

## License

MIT
