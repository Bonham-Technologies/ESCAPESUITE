import { describe, it, expect, vi, beforeEach } from 'vitest'
import { themeStorage } from './themeStorage'

// Mock the storage module
vi.mock('../core/storage', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))

import { getSetting, setSetting } from '../core/storage'

describe('themeStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('load', () => {
    it('returns stored light preference', async () => {
      vi.mocked(getSetting).mockResolvedValue('light')

      const result = await themeStorage.load()

      expect(result).toBe('light')
      expect(getSetting).toHaveBeenCalledWith('theme-preference')
    })

    it('returns stored dark preference', async () => {
      vi.mocked(getSetting).mockResolvedValue('dark')

      const result = await themeStorage.load()

      expect(result).toBe('dark')
    })

    it('returns stored system preference', async () => {
      vi.mocked(getSetting).mockResolvedValue('system')

      const result = await themeStorage.load()

      expect(result).toBe('system')
    })

    it('returns null for invalid preference', async () => {
      vi.mocked(getSetting).mockResolvedValue('invalid')

      const result = await themeStorage.load()

      expect(result).toBeNull()
    })

    it('returns null when no preference stored', async () => {
      vi.mocked(getSetting).mockResolvedValue(null)

      const result = await themeStorage.load()

      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      vi.mocked(getSetting).mockRejectedValue(new Error('Storage error'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await themeStorage.load()

      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalled()

      warnSpy.mockRestore()
    })
  })

  describe('save', () => {
    it('saves light preference', async () => {
      vi.mocked(setSetting).mockResolvedValue(undefined)

      await themeStorage.save('light')

      expect(setSetting).toHaveBeenCalledWith('theme-preference', 'light')
    })

    it('saves dark preference', async () => {
      vi.mocked(setSetting).mockResolvedValue(undefined)

      await themeStorage.save('dark')

      expect(setSetting).toHaveBeenCalledWith('theme-preference', 'dark')
    })

    it('saves system preference', async () => {
      vi.mocked(setSetting).mockResolvedValue(undefined)

      await themeStorage.save('system')

      expect(setSetting).toHaveBeenCalledWith('theme-preference', 'system')
    })

    it('logs error on failure', async () => {
      vi.mocked(setSetting).mockRejectedValue(new Error('Storage error'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await themeStorage.save('light')

      expect(errorSpy).toHaveBeenCalled()

      errorSpy.mockRestore()
    })
  })
})
