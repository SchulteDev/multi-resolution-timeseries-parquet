/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// `base` lets the same build serve from local root, GitHub Pages sub-path,
// or an Azure Blob container — the one-line local <-> prod switch.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
