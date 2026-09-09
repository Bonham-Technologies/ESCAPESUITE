import { describe, it, expect, afterEach, vi } from 'vitest'
import { isEmbedded, EDITOR_URL, editorUrl } from './index'

describe('isEmbedded', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false at top level (window.parent === window)', () => {
    expect(isEmbedded()).toBe(false)
  })

  it('is true when window.parent is a different object', () => {
    const originalParent = window.parent
    try {
      Object.defineProperty(window, 'parent', {
        value: {},
        configurable: true,
      })
      expect(isEmbedded()).toBe(true)
    } finally {
      Object.defineProperty(window, 'parent', {
        value: originalParent,
        configurable: true,
      })
    }
  })

  it('does not throw when window is undefined', async () => {
    vi.resetModules()
    vi.stubGlobal('window', undefined)
    const { isEmbedded: isEmbeddedNoWindow } = await import('./index')
    expect(() => isEmbeddedNoWindow()).not.toThrow()
    expect(isEmbeddedNoWindow()).toBe(false)
  })
})

describe('EDITOR_URL', () => {
  it('defaults to /artist/', () => {
    expect(EDITOR_URL).toBe('/artist/')
  })
})

describe('editorUrl', () => {
  it('returns bare EDITOR_URL with no params', () => {
    expect(editorUrl()).toBe('/artist/')
  })

  it('builds a query string from params', () => {
    expect(editorUrl({ loadVideo: 'abc 1' })).toBe('/artist/?loadVideo=abc+1')
  })
})

describe('VITE_EDITOR_URL override', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses the override when it has a trailing slash', async () => {
    vi.stubEnv('VITE_EDITOR_URL', 'https://example.com/editor/')
    vi.resetModules()
    const { EDITOR_URL: overriddenUrl } = await import('./index')
    expect(overriddenUrl).toBe('https://example.com/editor/')
  })

  it('normalises the override to end with a single slash', async () => {
    vi.stubEnv('VITE_EDITOR_URL', 'https://example.com/editor')
    vi.resetModules()
    const { EDITOR_URL: overriddenUrl } = await import('./index')
    expect(overriddenUrl).toBe('https://example.com/editor/')
  })

  it('collapses several trailing slashes down to one', async () => {
    vi.stubEnv('VITE_EDITOR_URL', 'https://example.com/editor//')
    vi.resetModules()
    const { EDITOR_URL: overriddenUrl } = await import('./index')
    expect(overriddenUrl).toBe('https://example.com/editor/')
  })

  it('normalises an absolute URL with no trailing slash', async () => {
    vi.stubEnv('VITE_EDITOR_URL', 'https://host/editor')
    vi.resetModules()
    const { EDITOR_URL: overriddenUrl } = await import('./index')
    expect(overriddenUrl).toBe('https://host/editor/')
  })
})
