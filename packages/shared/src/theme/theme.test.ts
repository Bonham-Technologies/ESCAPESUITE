import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ThemeStorage, ThemePreference, ResolvedTheme } from './theme'

// theme.ts holds module-level singleton state (currentPreference,
// currentResolved, systemMediaQuery, storage, subscribers), so reset the
// module registry before every test and re-import fresh.
let theme: typeof import('./theme')

/** A programmable matchMedia double that records listeners and lets tests fire 'change'. */
function createMatchMediaDouble(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(e: MediaQueryListEventInit) => void>()
  const mql = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((type: string, cb: (e: MediaQueryListEventInit) => void) => {
      if (type === 'change') listeners.add(cb)
    }),
    removeEventListener: vi.fn((type: string, cb: (e: MediaQueryListEventInit) => void) => {
      if (type === 'change') listeners.delete(cb)
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  const matchMedia = vi.fn().mockReturnValue(mql)
  return {
    matchMedia,
    mql,
    setMatches(next: boolean) {
      matches = next
    },
    fireChange() {
      listeners.forEach(cb => cb({ matches } as MediaQueryListEventInit))
    },
    listenerCount() {
      return listeners.size
    },
  }
}

/** A recording ThemeStorage double — never a mock of the module under test. */
function createRecordingStorage(initial: ThemePreference | null = null) {
  const saved: ThemePreference[] = []
  let loadError: Error | null = null
  let saveError: Error | null = null
  let stored = initial
  const storage: ThemeStorage = {
    load: vi.fn(async () => {
      if (loadError) throw loadError
      return stored
    }),
    save: vi.fn(async (preference: ThemePreference) => {
      if (saveError) throw saveError
      stored = preference
      saved.push(preference)
    }),
  }
  return {
    storage,
    saved,
    setStored(v: ThemePreference | null) {
      stored = v
    },
    failLoad(e: Error) {
      loadError = e
    },
    failSave(e: Error) {
      saveError = e
    },
  }
}

let originalMatchMedia: typeof window.matchMedia

beforeEach(async () => {
  vi.resetModules()
  theme = await import('./theme')
  originalMatchMedia = window.matchMedia
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  theme.cleanupTheme()
  window.matchMedia = originalMatchMedia
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
  delete (window as unknown as { ESCAPE_THEME?: unknown }).ESCAPE_THEME
})

describe('getSystemTheme', () => {
  it('returns dark when matchMedia reports dark preference', () => {
    const double = createMatchMediaDouble(true)
    window.matchMedia = double.matchMedia
    expect(theme.getSystemTheme()).toBe('dark')
    expect(double.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it('returns light when matchMedia reports no dark preference', () => {
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia
    expect(theme.getSystemTheme()).toBe('light')
  })
})

describe('resolveTheme', () => {
  it('resolves "light" to light', () => {
    expect(theme.resolveTheme('light')).toBe('light')
  })

  it('resolves "dark" to dark', () => {
    expect(theme.resolveTheme('dark')).toBe('dark')
  })

  it('resolves "system" via getSystemTheme', () => {
    const double = createMatchMediaDouble(true)
    window.matchMedia = double.matchMedia
    expect(theme.resolveTheme('system')).toBe('dark')

    double.setMatches(false)
    expect(theme.resolveTheme('system')).toBe('light')
  })
})

describe('applyTheme', () => {
  it('sets data-theme="light" when applying light', () => {
    theme.applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('removes data-theme when applying dark', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    theme.applyTheme('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('updates getResolvedTheme()', () => {
    theme.applyTheme('light')
    expect(theme.getResolvedTheme()).toBe('light')
    theme.applyTheme('dark')
    expect(theme.getResolvedTheme()).toBe('dark')
  })

  it('notifies subscribers with the applied theme', () => {
    const cb = vi.fn()
    theme.subscribe(cb)
    theme.applyTheme('light')
    expect(cb).toHaveBeenCalledWith('light')
  })

  it('continues notifying remaining subscribers when one throws, and logs the error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwing = vi.fn(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    theme.subscribe(throwing)
    theme.subscribe(ok)

    theme.applyTheme('light')

    expect(throwing).toHaveBeenCalled()
    expect(ok).toHaveBeenCalledWith('light')
    expect(errorSpy).toHaveBeenCalledWith('Theme subscriber error:', expect.any(Error))
  })
})

describe('loadThemePreference', () => {
  it('returns the default ("dark") when no storage has been configured', async () => {
    const result = await theme.loadThemePreference()
    expect(result).toBe('dark')
  })

  it('returns the stored preference when storage has a valid value', async () => {
    const { storage } = createRecordingStorage('light')
    await theme.initTheme(storage)
    const result = await theme.loadThemePreference()
    expect(result).toBe('light')
  })

  it('falls back to default when the stored value is invalid', async () => {
    const { storage } = createRecordingStorage('not-a-theme' as ThemePreference)
    await theme.initTheme(storage)
    const result = await theme.loadThemePreference()
    expect(result).toBe('dark')
  })

  it('falls back to default and warns when storage.load rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { storage, failLoad } = createRecordingStorage()
    failLoad(new Error('load failed'))
    await theme.initTheme(storage)

    const result = await theme.loadThemePreference()

    expect(result).toBe('dark')
    expect(warnSpy).toHaveBeenCalledWith('Failed to load theme preference:', expect.any(Error))
  })
})

describe('saveThemePreference', () => {
  it('does nothing when no storage has been configured', async () => {
    await expect(theme.saveThemePreference('light')).resolves.toBeUndefined()
  })

  it('calls storage.save with the preference', async () => {
    const { storage, saved } = createRecordingStorage()
    await theme.initTheme(storage)

    await theme.saveThemePreference('light')

    expect(saved).toEqual(['light'])
  })

  it('logs an error and does not throw when storage.save rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { storage, failSave } = createRecordingStorage()
    await theme.initTheme(storage)
    failSave(new Error('save failed'))

    await expect(theme.saveThemePreference('light')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('Failed to save theme preference:', expect.any(Error))
  })
})

describe('setTheme', () => {
  it('updates preference, applies the resolved theme, and persists', async () => {
    const { storage, saved } = createRecordingStorage()
    await theme.initTheme(storage)

    await theme.setTheme('light')

    expect(theme.getTheme()).toBe('light')
    expect(theme.getResolvedTheme()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    // initTheme only loads; setTheme is the only thing that persists.
    expect(saved).toEqual(['light'])
  })

  it('dispatches an escape-theme-changed CustomEvent with detail', async () => {
    const handler = vi.fn()
    window.addEventListener('escape-theme-changed', handler)

    await theme.setTheme('light')

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as CustomEvent<{ preference: ThemePreference; resolved: ResolvedTheme }>
    expect(event.detail).toEqual({ preference: 'light', resolved: 'light' })

    window.removeEventListener('escape-theme-changed', handler)
  })
})

describe('getTheme / getResolvedTheme', () => {
  it('getTheme returns the current preference', async () => {
    await theme.setTheme('light')
    expect(theme.getTheme()).toBe('light')
  })

  it('getResolvedTheme returns the current resolved theme', async () => {
    theme.applyTheme('light')
    expect(theme.getResolvedTheme()).toBe('light')
  })
})

describe('subscribe', () => {
  it('adds a subscriber that is notified on applyTheme', () => {
    const cb = vi.fn()
    theme.subscribe(cb)
    theme.applyTheme('light')
    expect(cb).toHaveBeenCalledWith('light')
  })

  it('returns an unsubscribe function that removes the callback', () => {
    const cb = vi.fn()
    const unsubscribe = theme.subscribe(cb)
    unsubscribe()
    theme.applyTheme('light')
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('parseThemeFromUrl', () => {
  const originalLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true })
  })

  it('returns null when there is no theme param', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      configurable: true,
    })
    expect(theme.parseThemeFromUrl()).toBeNull()
  })

  it('returns the theme param when it is a valid preference', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?theme=light' },
      configurable: true,
    })
    expect(theme.parseThemeFromUrl()).toBe('light')
  })

  it('returns null when the theme param is invalid', () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?theme=neon' },
      configurable: true,
    })
    expect(theme.parseThemeFromUrl()).toBeNull()
  })
})

describe('initTheme', () => {
  it('applies the URL-provided theme without persisting it', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { search: '?theme=light' },
      configurable: true,
    })
    const { storage, saved } = createRecordingStorage('dark')
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia

    await theme.initTheme(storage)

    expect(theme.getTheme()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(saved).toEqual([]) // URL override does not persist

    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true })
  })

  it('loads the stored preference when there is no URL override', async () => {
    const { storage } = createRecordingStorage('light')

    await theme.initTheme(storage)

    expect(theme.getTheme()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('registers a system media query change listener', async () => {
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia

    await theme.initTheme()

    expect(double.mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(double.listenerCount()).toBe(1)
  })

  it('re-resolves the theme on system change while preference is "system"', async () => {
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia
    const { storage } = createRecordingStorage('system')

    await theme.initTheme(storage)
    // matches=false initially -> resolves to light
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    double.setMatches(true)
    double.fireChange()

    // system now reports dark -> attribute removed
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('ignores system change events when preference is not "system"', async () => {
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia
    const { storage } = createRecordingStorage('light')

    await theme.initTheme(storage)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    double.setMatches(true)
    double.fireChange()

    // still light — system change is ignored when preference is fixed
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('exposes window.ESCAPE_THEME with a working API', async () => {
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia
    await theme.initTheme()

    expect(window.ESCAPE_THEME).toBeDefined()
    expect(window.ESCAPE_THEME.getTheme()).toBe(theme.getTheme())
    expect(window.ESCAPE_THEME.getResolvedTheme()).toBe(theme.getResolvedTheme())

    const cb = vi.fn()
    const unsubscribe = window.ESCAPE_THEME.subscribe(cb)
    theme.applyTheme('light')
    expect(cb).toHaveBeenCalledWith('light')
    unsubscribe()

    await window.ESCAPE_THEME.setTheme('dark')
    expect(theme.getTheme()).toBe('dark')
  })

  it('window.ESCAPE_THEME.setTheme rejects an invalid theme and logs an error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia
    await theme.initTheme()

    await window.ESCAPE_THEME.setTheme('neon' as ThemePreference)

    expect(errorSpy).toHaveBeenCalledWith('Invalid theme:', 'neon')
  })
})

describe('cleanupTheme', () => {
  it('removes the system media query listener', async () => {
    const double = createMatchMediaDouble(false)
    window.matchMedia = double.matchMedia
    await theme.initTheme()
    expect(double.listenerCount()).toBe(1)

    theme.cleanupTheme()

    expect(double.mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(double.listenerCount()).toBe(0)
  })

  it('clears subscribers', () => {
    const cb = vi.fn()
    theme.subscribe(cb)
    theme.cleanupTheme()
    theme.applyTheme('light')
    expect(cb).not.toHaveBeenCalled()
  })

  it('clears the configured storage (saveThemePreference becomes a no-op)', async () => {
    const { storage, saved } = createRecordingStorage()
    await theme.initTheme(storage)

    theme.cleanupTheme()
    await theme.saveThemePreference('light')

    expect(saved).toEqual([])
  })

  it('is safe to call when initTheme was never called', () => {
    expect(() => theme.cleanupTheme()).not.toThrow()
  })
})
