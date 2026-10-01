import { describe, it, expect } from 'vitest'
import { isSingleFileBuild } from '../../singleFileBuild.js'

// ESCSUITE-153: the headless render bundle (opened from file://) and the
// standalone offline build (downloaded and opened directly) both need every
// worker inlined into one HTML file; the hosted (saas) build is served over
// http(s) and keeps its worker as a separate, normally-fetchable chunk.
//
// The predicate itself lives beside vite.config.ts as plain JS
// (../../singleFileBuild.js, review round 1 NIT), not under src/ as
// TypeScript — vite.config.ts importing a .ts file breaks `tsc -b` (TS5097)
// without an extensionless import tripping Vite's `configLoader: 'native'`
// warning. This test stays under src/build/ regardless, because vitest's
// `test.include` only looks under src/**.
describe('isSingleFileBuild', () => {
  it('is true for the headless build', () => {
    expect(isSingleFileBuild({ VITE_HEADLESS: 'true' })).toBe(true)
  })

  it('is true for the standalone build', () => {
    expect(isSingleFileBuild({ VITE_BUILD_MODE: 'standalone' })).toBe(true)
  })

  it('is false for the hosted (saas) build', () => {
    expect(isSingleFileBuild({ VITE_BUILD_MODE: 'saas' })).toBe(false)
  })

  it('is false when neither env var is set (the default dev/build config)', () => {
    expect(isSingleFileBuild({})).toBe(false)
  })

  it('is true when both the headless flag and standalone mode are set', () => {
    expect(isSingleFileBuild({ VITE_HEADLESS: 'true', VITE_BUILD_MODE: 'standalone' })).toBe(true)
  })

  it('treats any value other than the literal string "true" for VITE_HEADLESS as off', () => {
    expect(isSingleFileBuild({ VITE_HEADLESS: 'false' })).toBe(false)
  })
})
