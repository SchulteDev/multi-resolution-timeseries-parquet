import type { Manifest } from '../shared/manifest'

// Join a manifest-relative path with the deploy base (local root, GitHub Pages
// sub-path, or an Azure Blob container URL). import.meta.env.BASE_URL always
// ends in '/', and manifest paths are relative ('data/...').
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(assetUrl('data/manifest.json'))
  if (!res.ok) throw new Error(`Failed to load manifest (${res.status}). Run \`npm run generate\` first.`)
  return res.json() as Promise<Manifest>
}
