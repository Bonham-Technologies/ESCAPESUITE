import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/**',
        'src/test/**',
        '**/*.d.ts',
        '**/*.config.*',
        'src/main.tsx', // React bootstrap only; exercised by every Playwright suite
      ],
      // Coverage floors — these only go up. See CLAUDE.md's Testing section.
      thresholds: {
        lines: 52,
        statements: 53,
        branches: 29,
        functions: 45,
      },
    },
  },
})
