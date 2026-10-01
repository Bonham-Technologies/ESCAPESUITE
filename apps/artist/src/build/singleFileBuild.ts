/**
 * The subset of `process.env` the build-mode predicate reads. Kept as a
 * structural type rather than `NodeJS.ProcessEnv` so this file — and its
 * test — have nothing Node-specific to import.
 */
export interface SingleFileBuildEnv {
  VITE_HEADLESS?: string
  VITE_BUILD_MODE?: string
}

/**
 * True when the build must ship as exactly one HTML file with every worker
 * inlined as a blob URL.
 *
 * Two build targets need this: the headless render bundle
 * (`dist-headless/headless.html`, opened by Playwright and the headless-artist
 * CLI from `file://`) and the standalone offline build (`dist/index.html`,
 * downloaded from a GitHub Release and opened directly — also `file://`, also
 * null-origin). Chromium blocks a `file://` page from loading a worker script
 * as a separate `file://` resource, so both targets need `decodeWorker`
 * inlined; the hosted (`saas`) build is served over http(s), where a separate
 * worker chunk is an ordinary same-origin fetch, so it keeps one.
 *
 * ESCSUITE-153: the standalone build used to skip this and ship `index.html`
 * plus a second `decodeWorker-*.js` chunk the GitHub release never attached —
 * so a downloaded build's MP4 export hung forever trying to start a worker
 * that was never there.
 */
export function isSingleFileBuild(env: SingleFileBuildEnv): boolean {
  return env.VITE_HEADLESS === 'true' || env.VITE_BUILD_MODE === 'standalone'
}
