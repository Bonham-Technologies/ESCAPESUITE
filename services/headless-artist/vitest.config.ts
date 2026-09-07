/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The *.chromium.test.ts files each build the headless bundle in `beforeAll`, and vite
    // empties `apps/artist/dist-headless/` before it rewrites it. Run in parallel, two of those
    // builds overlap and a third file sees the bundle missing mid-write
    // (`net::ERR_FILE_NOT_FOUND at .../headless.html`). One test file at a time is also simply
    // right for tests that each launch a Chromium and encode video. The unit suite is fast
    // enough that serialising it costs nothing worth measuring.
    fileParallelism: false,
  },
})
