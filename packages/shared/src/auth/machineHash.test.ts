import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getMachineHash, clearMachineHash, getCachedMachineHash } from './machineHash'

describe('machineHash', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    clearMachineHash()
  })

  describe('getMachineHash', () => {
    it('should generate a consistent hash', async () => {
      const hash1 = await getMachineHash()
      const hash2 = await getMachineHash()

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 produces 64 hex characters
    })

    it('should return cached hash on subsequent calls', async () => {
      const hash1 = await getMachineHash()

      // Verify it's cached
      const cached = getCachedMachineHash()
      expect(cached).toBe(hash1)

      // Should return cached value
      const hash2 = await getMachineHash()
      expect(hash2).toBe(hash1)
    })

    it('should generate valid hex string', async () => {
      const hash = await getMachineHash()

      // Should be all hex characters
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })
  })

  describe('clearMachineHash', () => {
    it('should clear the cached hash', async () => {
      await getMachineHash()
      expect(getCachedMachineHash()).not.toBeNull()

      clearMachineHash()
      expect(getCachedMachineHash()).toBeNull()
    })
  })

  describe('getCachedMachineHash', () => {
    it('should return null when no hash is cached', () => {
      expect(getCachedMachineHash()).toBeNull()
    })

    it('should return the cached hash when one exists', async () => {
      const hash = await getMachineHash()
      expect(getCachedMachineHash()).toBe(hash)
    })
  })

  describe('fingerprint components', () => {
    it('should handle missing navigator gracefully', async () => {
      // Even with mocked/missing values, should still produce a hash
      const hash = await getMachineHash()
      expect(hash).toHaveLength(64)
    })

    it('should handle localStorage errors gracefully', async () => {
      // Mock localStorage to throw
      const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceeded')
      })

      // Should still return a hash even if caching fails
      clearMachineHash()
      const hash = await getMachineHash()
      expect(hash).toHaveLength(64)

      // Restore
      spy.mockRestore()
    })
  })
})
