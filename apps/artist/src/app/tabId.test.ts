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

describe('outside a secure context', () => {
  it('still mints an id where crypto.randomUUID does not exist', () => {
    // `crypto.randomUUID` is exposed to secure contexts only: an editor served
    // over plain http from a LAN address has none, and must still start.
    // jsdom's `randomUUID` lives on the prototype; an own `undefined` hides it.
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const minted = readTabId()

      // crypto.getRandomValues exists outside a secure context (fix round 1, LOW-4).
      expect(minted).toMatch(/^[0-9a-f]{32}$/)
      expect(renewTabId()).not.toBe(minted)
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID
    }
  })
})


// ESCSUITE-332: sessionStorage belongs to the top-level tab, so two
// same-origin ESCAPEARTIST frames in one host page share it — the second frame
// renewed the first's id and wrote over the shared key, and after a host reload
// the two frames swapped sessions. An embedded document never reads or writes
// the id key: a host that names its frame with `?tabKey=` gets an id derived
// from that name, and a frame with no name gets one for this page load only.
describe('in a frame (ESCSUITE-332)', () => {
  it('derives the id from the host\'s tabKey and leaves sessionStorage alone', () => {
    sessionStorage.setItem(TAB_ID_KEY, 'the-other-frame')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    expect(readTabId({ embedded: true, tabKey: 'left-pane' })).toBe('host:left-pane')
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('answers the same id for the same key on every read, so a host reload keeps the frame\'s slot', () => {
    expect(readTabId({ embedded: true, tabKey: 'a' })).toBe('host:a')
    expect(readTabId({ embedded: true, tabKey: 'a' })).toBe('host:a')
    expect(readTabId({ embedded: true, tabKey: 'b' })).toBe('host:b')
  })

  it('mints an id for this page load only when the host named no key', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const first = readTabId({ embedded: true, tabKey: null })
    const second = readTabId({ embedded: true, tabKey: null })

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).not.toBe(first)
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('renews in memory, never writing the shared key', () => {
    sessionStorage.setItem(TAB_ID_KEY, 'the-other-frame')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const renewed = renewTabId({ embedded: true, tabKey: null })

    expect(renewed).toMatch(/^[0-9a-f-]{36}$/)
    expect(setItem).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe('the-other-frame')
  })

  it('never renews a host-named id to another host id: a second frame with the same key warns once and gets an id for this page load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const renewed = renewTabId({ embedded: true, tabKey: 'left-pane' })

    expect(renewed).toMatch(/^[0-9a-f-]{36}$/)
    expect(setItem).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('left-pane')
  })

  it('a document that is not embedded ignores a tabKey and keeps today\'s sessionStorage id', () => {
    // A tabKey only names a frame; a top-level tab already has a
    // sessionStorage of its own.
    sessionStorage.setItem(TAB_ID_KEY, 'top-level-tab')

    expect(readTabId({ embedded: false, tabKey: 'left-pane' })).toBe('top-level-tab')
    const renewed = renewTabId({ embedded: false, tabKey: 'left-pane' })
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(renewed)
  })
})
