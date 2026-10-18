import { vi } from 'vitest'

/**
 * Which engine jsdom pretends to be, for the code that gates on one
 * (`isMeasuredFrameRateEngine`, ESCSUITE-327). jsdom is an engine nobody
 * measured, and stays that way by default; a suite that needs the probe to run
 * says `setEngine('chromium')` and `restoreEngine()` after. Only what it
 * touched is put back — `vi.unstubAllGlobals()` would drop `setup.ts`'s stubs
 * too (ESCSUITE-119).
 */
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0'
let userAgent: ReturnType<typeof vi.spyOn> | null = null

export function restoreEngine(): void {
  userAgent?.mockRestore()
  userAgent = null
  delete (navigator as { userAgentData?: unknown }).userAgentData
}

export function setEngine(engine: 'chromium' | 'firefox'): void {
  restoreEngine()
  if (engine === 'chromium') {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { brands: [{ brand: 'Chromium' }] },
    })
  } else {
    userAgent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(FIREFOX_UA)
  }
}
