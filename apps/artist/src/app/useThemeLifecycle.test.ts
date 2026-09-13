// The theme lifecycle: what mounting starts, and what unmounting stops.
//
// Nothing is mocked here. The shared theme module is a singleton with real
// observable effects — it reads the saved preference through the storage
// adapter the hook hands it, writes `data-theme` on the document, and holds a
// listener on the `(prefers-color-scheme: dark)` media query — so the tests
// watch those rather than watching `initTheme` be called.
//
// The saved preference is seeded as 'light' because that is the one value the
// module writes to the document as an attribute: 'dark' is its default *and*
// what it represents by removing the attribute, so a 'light' round-trip is the
// only one that proves the adapter was actually used.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useThemeLifecycle } from './useThemeLifecycle'
import { cleanupTheme, getTheme } from '@escapesuite/shared/theme'
import { setSetting } from '../core/storage'

/** The key ESCAPEARTIST's themeStorage adapter persists the preference under. */
const THEME_STORAGE_KEY = 'theme-preference'

/** The media query the module listens to, and the one this file asserts on. */
const SYSTEM_QUERY = '(prefers-color-scheme: dark)'

/** The MediaQueryList double `window.matchMedia` handed out most recently. */
const lastMediaQuery = () => {
  const calls = vi.mocked(window.matchMedia).mock.results
  return calls[calls.length - 1].value as MediaQueryList
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanupTheme()
  document.documentElement.removeAttribute('data-theme')
})

describe('useThemeLifecycle', () => {
  it('starts the theme module with the editor\'s own storage adapter', async () => {
    await setSetting(THEME_STORAGE_KEY, 'light')

    renderHook(() => useThemeLifecycle())

    // The stored 'light' only reaches the module through themeStorage; without
    // the adapter the module would keep its 'dark' default.
    await waitFor(() => expect(getTheme()).toBe('light'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('listens for system theme changes while it is mounted', async () => {
    renderHook(() => useThemeLifecycle())

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalledWith(SYSTEM_QUERY))
    expect(lastMediaQuery().addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('stops listening when it unmounts', async () => {
    const { unmount } = renderHook(() => useThemeLifecycle())
    await waitFor(() => expect(window.matchMedia).toHaveBeenCalledWith(SYSTEM_QUERY))
    const mediaQuery = lastMediaQuery()
    const added = vi.mocked(mediaQuery.addEventListener).mock.calls[0][1]

    unmount()

    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', added)
  })
})
