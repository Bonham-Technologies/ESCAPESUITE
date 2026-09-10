import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The IndexedDB settings store is this adapter's collaborator; the adapter
// itself (validation, error swallowing) is exercised for real.
const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))
vi.mock('../core/storage', () => ({ getSetting, setSetting }))

import { themeStorage } from './themeStorage'

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  getSetting.mockReset()
  setSetting.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  error.mockRestore()
})

describe('themeStorage.load', () => {
  it.each(['light', 'dark', 'system'] as const)('returns the stored %s preference', async (pref) => {
    getSetting.mockResolvedValue(pref)
    await expect(themeStorage.load()).resolves.toBe(pref)
    expect(getSetting).toHaveBeenCalledWith('theme-preference')
  })

  it('returns null when nothing has been stored yet', async () => {
    getSetting.mockResolvedValue(undefined)
    await expect(themeStorage.load()).resolves.toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects a stored value that is not a known preference', async () => {
    getSetting.mockResolvedValue('chartreuse')
    await expect(themeStorage.load()).resolves.toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when the settings read fails', async () => {
    getSetting.mockRejectedValue(new Error('db closed'))
    await expect(themeStorage.load()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith('Failed to load theme preference:', expect.any(Error))
  })
})

describe('themeStorage.save', () => {
  it('writes the preference under the theme key', async () => {
    setSetting.mockResolvedValue(undefined)
    await themeStorage.save('light')
    expect(setSetting).toHaveBeenCalledWith('theme-preference', 'light')
    expect(error).not.toHaveBeenCalled()
  })

  it('logs and swallows a failed write so the UI is not broken by it', async () => {
    setSetting.mockRejectedValue(new Error('quota exceeded'))
    await expect(themeStorage.save('dark')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('Failed to save theme preference:', expect.any(Error))
  })
})
