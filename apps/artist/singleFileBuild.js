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
 *
 * Plain JS, not TypeScript (ESCSUITE-153 review round 1, NIT): `vite.config.ts`
 * is type-checked under `tsconfig.node.json`, which has no
 * `allowImportingTsExtensions`, so a `.ts`-suffixed import specifier fails
 * `tsc -b` with TS5097; dropping the suffix instead left Vite's
 * `configLoader: 'native'` warning on every invocation asking for one. A
 * plain `.js` file beside the config sidesteps both — the import specifier
 * carries its real extension (silencing the warning) without ever being a
 * `.ts` import (so TS5097 does not apply). See `singleFileBuild.d.ts` for the
 * type `vite.config.ts` and the unit test both get for free.
 *
 * @param {{ VITE_HEADLESS?: string, VITE_BUILD_MODE?: string }} env
 * @returns {boolean}
 */
export function isSingleFileBuild(env) {
  return env.VITE_HEADLESS === 'true' || env.VITE_BUILD_MODE === 'standalone'
}
