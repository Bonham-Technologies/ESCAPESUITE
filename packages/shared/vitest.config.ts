/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
      ],
      // Coverage floors — these only go up. See CLAUDE.md's Testing section.
      thresholds: {
        lines: 27,
        statements: 28,
        branches: 33,
        functions: 20,
      },
    },
  },
})
