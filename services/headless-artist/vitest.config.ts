/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Builds the headless bundle + kit once before the chromium suite (see the file for why,
    // and why it no-ops for every other invocation, including the plain unit suite).
    globalSetup: ['./test/globalSetup.ts'],
    // The *.chromium.test.ts files each launch their own headless Chromium and encode real
    // video; running three of those at once triples peak CPU/memory on a CI runner for no
    // measurable time savings (the slow part was the now-deduplicated build, not the renders).
    // The unit suite is fast enough that serialising it costs nothing worth measuring.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/**',
        'test/**',
        '**/*.d.ts',
        '**/*.config.*',
        // vi.mock('./renderDriver') in run.test.ts auto-mocks this module without calling its
        // real function bodies, so unit-suite coverage of it is near-zero and meaningless.
        // Its only real coverage comes from src/renderDriver.chromium.test.ts (test:e2e), which
        // isn't part of test:coverage.
        'src/renderDriver.ts',
      ],
      // Coverage floors — these only go up. See CLAUDE.md's Testing section.
      // Higher than the coverage program's original 85/83/80/80 baseline because excluding
      // renderDriver.ts (see above) removes an always-near-0%-covered file from the denominator.
      thresholds: {
        lines: 91,
        statements: 91,
        branches: 83,
        functions: 94,
      },
    },
  },
})
