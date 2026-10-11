// This tab's id (ESCSUITE-274): the key of its own session slot and the name
// of its own tab lock. Kept in `sessionStorage`, which is per tab and survives
// a reload, so a reloaded tab finds its slot again and a new tab gets a new one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readTabId, renewTabId, TAB_ID_KEY } from './tabId'

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('readTabId', () => {
  it('answers the id this tab already has, so a reload keeps its slot', () => {
    sessionStorage.setItem(TAB_ID_KEY, 'tab-before-reload')

    expect(readTabId()).toBe('tab-before-reload')
  })

  it('mints an id for a new tab and keeps it for the next read', () => {
    const minted = readTabId()

    expect(minted).toMatch(/^[0-9a-f-]{36}$/)
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(minted)
    expect(readTabId()).toBe(minted)
  })

  it('still answers an id where sessionStorage throws, and does not throw itself', () => {
    // A sandboxed frame without allow-same-origin: every access is a
    // SecurityError. The tab then has a slot for this document only.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })

    expect(readTabId()).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('renewTabId', () => {
  it('mints a different id and keeps it in place of the old one', () => {
    sessionStorage.setItem(TAB_ID_KEY, 'copied-from-another-tab')

    const renewed = renewTabId()

    expect(renewed).not.toBe('copied-from-another-tab')
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(renewed)
  })

  it('still answers the new id where sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })

    expect(renewTabId()).toMatch(/^[0-9a-f-]{36}$/)
  })
})
