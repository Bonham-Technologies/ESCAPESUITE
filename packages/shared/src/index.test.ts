import { describe, it, expect } from 'vitest'
import { ESCAPE_SUITE_VERSION, SHARED_DB_NAME, isBrowser, isProduction } from './index'

describe('shared root barrel exports', () => {
  it('exports the package version string', () => {
    expect(ESCAPE_SUITE_VERSION).toBe('1.0.0')
  })

  it('exports the shared IndexedDB database name', () => {
    expect(SHARED_DB_NAME).toBe('video-editor-db')
  })

  it('detects the browser environment (jsdom exposes window)', () => {
    expect(isBrowser).toBe(true)
  })

  it('exports a boolean isProduction flag', () => {
    expect(typeof isProduction).toBe('boolean')
  })
})
