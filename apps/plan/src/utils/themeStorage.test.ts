import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// getSetting/setSetting (the shared IndexedDB layer) are collaborators of
// themeStorage — mock them, never the module under test.
vi.mock('@escapesuite/shared/storage', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))

import { getSetting, setSetting } from '@escapesuite/shared/storage'
import { themeStorage } from './themeStorage'

const THEME_KEY = 'theme-preference'

describe('themeStorage.load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('returns the preference from IndexedDB when it is valid', async () => {
    vi.mocked(getSetting).mockResolvedValue('dark')

    const result = await themeStorage.load()

    expect(result).toBe('dark')
    expect(getSetting).toHaveBeenCalledWith(THEME_KEY)
  })

  it('falls back to localStorage when IndexedDB has no value', async () => {
    vi.mocked(getSetting).mockResolvedValue(undefined)
    localStorage.setItem(THEME_KEY, 'light')

    const result = await themeStorage.load()

    expect(result).toBe('light')
  })

  it('falls back to localStorage when the IndexedDB value is invalid', async () => {
    vi.mocked(getSetting).mockResolvedValue('neon' as never)
    localStorage.setItem(THEME_KEY, 'system')

    const result = await themeStorage.load()

    expect(result).toBe('system')
  })

  it('falls back to localStorage and warns when getSetting rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getSetting).mockRejectedValue(new Error('idb down'))
    localStorage.setItem(THEME_KEY, 'dark')

    const result = await themeStorage.load()

    expect(result).toBe('dark')
    expect(warnSpy).toHaveBeenCalledWith('Failed to load theme from IndexedDB:', expect.any(Error))
  })

  it('returns null when localStorage also has no valid value', async () => {
    vi.mocked(getSetting).mockResolvedValue(undefined)

    const result = await themeStorage.load()

    expect(result).toBeNull()
  })

  it('returns null when localStorage has an invalid value', async () => {
    vi.mocked(getSetting).mockResolvedValue(undefined)
    localStorage.setItem(THEME_KEY, 'neon')

    const result = await themeStorage.load()

    expect(result).toBeNull()
  })

  it('returns null and warns when localStorage.getItem throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getSetting).mockResolvedValue(undefined)
    const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    const result = await themeStorage.load()

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Failed to load theme from localStorage:', expect.any(Error))

    getItemSpy.mockRestore()
  })
})

describe('themeStorage.save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves to both IndexedDB and localStorage', async () => {
    vi.mocked(setSetting).mockResolvedValue(undefined)

    await themeStorage.save('dark')

    expect(setSetting).toHaveBeenCalledWith(THEME_KEY, 'dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('still saves to localStorage and logs an error when setSetting rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(setSetting).mockRejectedValue(new Error('idb down'))

    await themeStorage.save('light')

    expect(errorSpy).toHaveBeenCalledWith('Failed to save theme to IndexedDB:', expect.any(Error))
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
  })

  it('logs an error when localStorage.setItem throws, without throwing itself', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(setSetting).mockResolvedValue(undefined)
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    await expect(themeStorage.save('system')).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('Failed to save theme to localStorage:', expect.any(Error))

    setItemSpy.mockRestore()
  })
})
