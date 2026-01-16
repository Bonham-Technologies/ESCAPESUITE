/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
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
