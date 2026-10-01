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
 * inlined as a blob URL. See singleFileBuild.js for the full explanation.
 */
export function isSingleFileBuild(env: SingleFileBuildEnv): boolean
