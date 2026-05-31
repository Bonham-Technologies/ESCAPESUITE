/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { visualizer } from 'rollup-plugin-visualizer'

// Warn loudly when a standalone build is produced without the license public
// key baked in: such a build cannot verify license signatures (audit H4).
if (process.env.VITE_BUILD_MODE === 'standalone' && !process.env.VITE_LICENSE_PUBLIC_KEY) {
  console.warn(
    '\n⚠️  [escapesuite] Standalone build WITHOUT VITE_LICENSE_PUBLIC_KEY — ' +
    'license signatures will NOT be verified. Set the key for production/shipping builds.\n'
  )
}

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
    // License key for standalone builds
    // If no key provided in standalone mode, use placeholder for server-side injection
    'import.meta.env.VITE_LICENSE_KEY': JSON.stringify(
      process.env.VITE_LICENSE_KEY ||
      (process.env.VITE_BUILD_MODE === 'standalone' ? '__ESCAPE_LICENSE_PLACEHOLDER__' : '')
    ),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types.ts',
      ],
    },
  },
})
