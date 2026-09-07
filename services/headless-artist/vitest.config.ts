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
  },
})
