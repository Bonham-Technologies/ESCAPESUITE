// The slots this tab has turned down (ESCSUITE-306): another tab's session that
// the user answered "Start Fresh" to here. The slot is left in storage — its tab
// may only have been discarded, and will come back for it — and this list is
// how this tab knows not to offer it again.
//
// Kept in `sessionStorage` beside the tab id, so it survives this tab's reloads
// and no other tab sees it; where `sessionStorage` cannot be used, it lasts for
// the document.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DECLINED_SLOTS_KEY, readDeclinedSlots, rememberDeclinedSlot } from './declinedSlots'

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('declined slots', () => {
  it('is empty for a tab that has declined nothing', () => {
    expect([...readDeclinedSlots()]).toEqual([])
  })

  it('remembers a declined slot in sessionStorage, as a JSON list of tab ids', () => {
    rememberDeclinedSlot('tab-a')
    rememberDeclinedSlot('tab-b')

    expect(JSON.parse(sessionStorage.getItem(DECLINED_SLOTS_KEY)!)).toEqual(['tab-a', 'tab-b'])
    expect(readDeclinedSlots()).toEqual(new Set(['tab-a', 'tab-b']))
  })

  it('does not list a slot twice', () => {
    rememberDeclinedSlot('tab-a')
    rememberDeclinedSlot('tab-a')

    expect(JSON.parse(sessionStorage.getItem(DECLINED_SLOTS_KEY)!)).toEqual(['tab-a'])
  })

  it('reads a list a reload of this tab left behind', () => {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, JSON.stringify(['tab-a']))

    expect(readDeclinedSlots()).toEqual(new Set(['tab-a']))
  })

  it('reads a stored value that is not a list as no list at all', () => {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, JSON.stringify({ 'tab-a': true }))

    expect([...readDeclinedSlots()]).toEqual([])
  })

  it('reads a stored value that is not JSON as no list at all, and a decline still writes a good one', () => {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, '[not json')

    expect([...readDeclinedSlots()]).toEqual([])
    rememberDeclinedSlot('tab-a')
    expect(JSON.parse(sessionStorage.getItem(DECLINED_SLOTS_KEY)!)).toEqual(['tab-a'])
  })

  it('keeps the list for this document when sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('sandboxed', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('sandboxed', 'SecurityError')
    })

    expect(() => rememberDeclinedSlot('only-in-this-document')).not.toThrow()
    expect(readDeclinedSlots().has('only-in-this-document')).toBe(true)
  })
})
