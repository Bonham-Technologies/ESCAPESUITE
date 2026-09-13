// The theme lifecycle hook: one effect, and the pair of calls it owes the
// shared theme module.
//
// The theme module itself owns the document attribute and the media-query
// listener — a collaborator, doubled here the same way the App tests double
// it, so what is asserted is that the hook calls it with the recorder's own
// storage adapter on the way in and cleans up on the way out.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useThemeLifecycle } from './useThemeLifecycle'
import { themeStorage } from '../utils/themeStorage'

const { initTheme, cleanupTheme } = vi.hoisted(() => ({
  initTheme: vi.fn(),
  cleanupTheme: vi.fn(),
}))
vi.mock('@escapesuite/shared/theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/theme')>()),
  initTheme,
  cleanupTheme,
}))

beforeEach(() => {
  initTheme.mockClear()
  cleanupTheme.mockClear()
})

describe('useThemeLifecycle', () => {
  it('initializes the theme from the recorder\'s own storage on mount', () => {
    renderHook(() => useThemeLifecycle())

    expect(initTheme).toHaveBeenCalledTimes(1)
    expect(initTheme).toHaveBeenCalledWith(themeStorage)
    expect(cleanupTheme).not.toHaveBeenCalled()
  })

  it('cleans the theme up when the screen goes away', () => {
    const { unmount } = renderHook(() => useThemeLifecycle())

    unmount()

    expect(cleanupTheme).toHaveBeenCalledTimes(1)
  })

  it('does not re-initialize on a re-render', () => {
    const { rerender } = renderHook(() => useThemeLifecycle())

    rerender()
    rerender()

    expect(initTheme).toHaveBeenCalledTimes(1)
    expect(cleanupTheme).not.toHaveBeenCalled()
  })
})
