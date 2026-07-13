// Resolution tiers and time-bucket math. Shared by the build script and the
// frontend so both agree on bucket boundaries and the tier ladder.

export const RES = {
  '1min': 60_000,
  '15min': 900_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
} as const

export type Resolution = keyof typeof RES

// Finest -> coarsest. Order matters for tier selection.
export const RESOLUTIONS = ['1min', '15min', '1h', '1d'] as const satisfies readonly Resolution[]

// Epoch-aligned bucket start. Because epoch 0 is a UTC midnight, minute/15min/
// hour/day buckets all align to natural calendar boundaries, and each coarser
// bucket is an exact multiple of the next finer one — which is what makes the
// cascade rollup and the frontend's arithmetic row-indexing exact.
export function bucketStart(ts: number, bucketMs: number): number {
  return Math.floor(ts / bucketMs) * bucketMs
}
