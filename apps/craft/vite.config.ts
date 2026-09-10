/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    // Run with ANALYZE=true to generate bundle-stats.html
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'bundle-stats.html',
      open: true,
      gzipSize: true,
    }),
  ].filter(Boolean),
  build: {
    target: 'esnext',
    cssCodeSplit: false,
  },
  define: {
    // Build mode: 'saas' (default) or 'standalone'
    'import.meta.env.VITE_BUILD_MODE': JSON.stringify(process.env.VITE_BUILD_MODE || 'saas'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types.ts',
        'src/main.tsx', // React bootstrap only; exercised by every Playwright suite
      ],
      // Coverage floors — these only go up. See CLAUDE.md's Testing section.
      thresholds: {
        lines: 75,
        statements: 74,
        branches: 64,
        functions: 65,
      },
    },
  },
})
