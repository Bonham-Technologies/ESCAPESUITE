// The saves this tab has turned down (ESCSUITE-306): another tab's session that
// the user answered "Start Fresh" to here. The slot is left in storage — its tab
// may only have been discarded, and will come back for it — and this list is
// how this tab knows not to offer that same save again. An entry names the
// save, `{ tabId, timestamp }`, not the tab: a newer save from the same tab is
// a different question (ESCSUITE-289's principle) and is offered again.
//
// Kept in `sessionStorage` beside the tab id, so it survives this tab's reloads
// and no other tab sees it; where `sessionStorage` cannot be written, it lasts
// for the document.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  __resetDeclinedSlotsForTests,
  DECLINED_SLOTS_KEY,
  readDeclinedSlots,
  rememberDeclinedSlot,
} from './declinedSlots'

const stored = (): unknown => JSON.parse(sessionStorage.getItem(DECLINED_SLOTS_KEY)!)

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  __resetDeclinedSlotsForTests()
})

describe('declined saves', () => {
  it('is empty for a tab that has declined nothing', () => {
    expect(readDeclinedSlots()).toEqual([])
  })

  it('remembers a declined save in sessionStorage, as a JSON list of { tabId, timestamp }', () => {
    rememberDeclinedSlot({ tabId: 'tab-a', timestamp: 1 })
    rememberDeclinedSlot({ tabId: 'tab-b', timestamp: 2 })

    expect(stored()).toEqual([
      { tabId: 'tab-a', timestamp: 1 },
      { tabId: 'tab-b', timestamp: 2 },
    ])
    expect(readDeclinedSlots()).toEqual([
      { tabId: 'tab-a', timestamp: 1 },
      { tabId: 'tab-b', timestamp: 2 },
    ])
  })

  it('keeps one entry per tab: declining a newer save from the same tab replaces the older one', () => {
    rememberDeclinedSlot({ tabId: 'tab-a', timestamp: 1 })
    rememberDeclinedSlot({ tabId: 'tab-a', timestamp: 5 })

    expect(stored()).toEqual([{ tabId: 'tab-a', timestamp: 5 }])
  })

  it('reads a list a reload of this tab left behind', () => {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, JSON.stringify([{ tabId: 'tab-a', timestamp: 1 }]))

    expect(readDeclinedSlots()).toEqual([{ tabId: 'tab-a', timestamp: 1 }])
  })

  it('drops a stored entry that is not { tabId: string, timestamp: number }, and keeps the good ones', () => {
    sessionStorage.setItem(
      DECLINED_SLOTS_KEY,
      JSON.stringify([
        'tab-a', // the shape of the first version of this list: a bare tab id
        null,
        { tabId: 7, timestamp: 1 },
        { tabId: 'tab-b', timestamp: '1' },
        { tabId: 'tab-c' },
        { tabId: 'tab-d', timestamp: 4 },
      ])
    )

    expect(readDeclinedSlots()).toEqual([{ tabId: 'tab-d', timestamp: 4 }])
  })

  it('reads a stored value that is not a list as no list at all', () => {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, JSON.stringify({ tabId: 'tab-a', timestamp: 1 }))

    expect(readDeclinedSlots()).toEqual([])
  })

  it('reads a stored value that is not JSON as no list at all, and a decline still writes a good one', () => {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, '[not json')

    expect(readDeclinedSlots()).toEqual([])
    rememberDeclinedSlot({ tabId: 'tab-a', timestamp: 1 })
    expect(stored()).toEqual([{ tabId: 'tab-a', timestamp: 1 }])
  })

  it('keeps the list for this document when sessionStorage throws, until the module is reset', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('sandboxed', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('sandboxed', 'SecurityError')
    })

    expect(() => rememberDeclinedSlot({ tabId: 'tab-a', timestamp: 1 })).not.toThrow()
    expect(readDeclinedSlots()).toEqual([{ tabId: 'tab-a', timestamp: 1 }])

    __resetDeclinedSlotsForTests()
    expect(readDeclinedSlots()).toEqual([])
  })
})
