// Which saved session the startup prompt offers (ESCSUITE-274), and how a
// restored one changes hands.
//
// Every tab keeps its own slot, and every tab holds `escapeartist-tab:<id>` for
// its lifetime, so a slot whose tab lock is free is a session nobody is still
// working in — a tab that closed or crashed. Storage is the App suite's
// recording double; the locks are the Web Locks double the ESCSUITE-227 suites
// use, installed on `navigator` the way the browser provides it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { adoptSessionSlot, findOfferableSlot, slotAtAnswer } from './sessionSlots'
import { claimOfferLock, holdTabLock, offerLockName, probeTabLock, tabLockName } from './sessionLock'
import { SESSION_SLOT_MAX_AGE_MS } from './appConstants'
import {
  clearSessionState,
  listSessionStates,
  saveSessionState,
  type SessionSlot,
  type SessionState,
} from '../core/storage'
import { sampleVideo } from '../test/appDoubles'
import { createFakeLocks, flushLocks, type FakeLocks } from '../test/doubles/locks'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())

const NOW = Date.parse('2026-10-10T12:00:00Z')

const slot = (tabId: string | null, timestamp: number, overrides: Partial<SessionState> = {}): SessionSlot => ({
  tabId,
  session: {
    tabId: tabId ?? undefined,
    project: { name: `Work of ${tabId}`, timeline: { clips: [] } },
    sourceVideos: [{ ...sampleVideo }],
    currentTime: 0,
    selectedClipId: null,
    zoom: 1,
    timestamp,
    ...overrides,
  } as SessionState,
})

let fake: FakeLocks

/** The slot `findOfferableSlot` offers, or `null`. */
const offered = async (tabId: string, now: number): Promise<SessionSlot | null> =>
  (await findOfferableSlot(tabId, now))?.slot ?? null

/** Another tab, still open: it holds its own tab lock. */
const aliveTab = async (tabId: string) => {
  holdTabLock(tabId, fake.locks)
  await flushLocks()
}

beforeEach(() => {
  fake = createFakeLocks()
  Object.defineProperty(navigator, 'locks', { value: fake.locks, configurable: true })
})

afterEach(() => {
  delete (navigator as { locks?: LockManager }).locks
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('findOfferableSlot', () => {
  it('offers the newest slot whose tab is gone', async () => {
    const older = slot('crashed-early', NOW - 60_000)
    const newer = slot('crashed-late', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([older, newer])

    await expect(offered('me', NOW)).resolves.toBe(newer)
  })

  it('skips a slot whose tab is still alive and offers the next newest', async () => {
    const crashed = slot('crashed', NOW - 60_000)
    const live = slot('alive', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([crashed, live])
    await aliveTab('alive')

    await expect(offered('me', NOW)).resolves.toBe(crashed)
  })

  it('offers nothing when every slot belongs to a live tab', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('alive', NOW - 1_000)])
    await aliveTab('alive')

    await expect(offered('me', NOW)).resolves.toBeNull()
  })

  // Fix round 1 (MAJOR-1): this tab's own slot comes first whenever it exists.
  // It is this tab's own session after a reload or a browser crash-restore,
  // and offering another tab's newer slot instead would lose it either way —
  // a restore adopts over it, a decline leaves it for the next edit to
  // overwrite.
  it('offers this tab\'s own slot ahead of another tab\'s newer free one', async () => {
    const mine = slot('me', NOW - 60_000)
    const newer = slot('crashed', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([newer, mine])

    await expect(offered('me', NOW)).resolves.toBe(mine)
    expect(fake.log).toEqual([])
  })

  it('offers nothing when this tab\'s own slot holds no media, rather than another tab\'s slot over it', async () => {
    // Restoring the other slot would adopt it over this tab's own work.
    vi.mocked(listSessionStates).mockResolvedValue([
      slot('me', NOW - 60_000, { sourceVideos: [] }),
      slot('crashed', NOW - 1_000),
    ])

    await expect(offered('me', NOW)).resolves.toBeNull()
  })

  it('offers the newest free slot when this tab has none of its own', async () => {
    const older = slot('closed-early', NOW - 60_000)
    const newer = slot('closed-late', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([older, newer])

    await expect(offered('me', NOW)).resolves.toBe(newer)
  })

  it('treats this tab\'s own slot past the age limit as gone, and offers the next', async () => {
    const other = slot('crashed', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([slot('me', NOW - SESSION_SLOT_MAX_AGE_MS - 1), other])

    await expect(offered('me', NOW)).resolves.toBe(other)
    expect(clearSessionState).toHaveBeenCalledWith('me')
  })

  it('offers this tab\'s own slot — a reload — without probing a lock it is about to hold', async () => {
    const mine = slot('me', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([mine])
    // This tab queues for its own lock as the editor mounts; a probe would
    // find that and call the reload "another tab".
    holdTabLock('me', fake.locks)

    await expect(offered('me', NOW)).resolves.toBe(mine)
    expect(fake.log).toEqual(['acquire'])
  })

  it('offers the row an older build shared between tabs as a slot with no owner, without a probe', async () => {
    const legacy = slot(null, NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([legacy])

    await expect(offered('me', NOW)).resolves.toBe(legacy)
    expect(fake.log).toEqual([])
  })

  it('does not offer a slot with no media in it', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('crashed', NOW - 1_000, { sourceVideos: [] })])

    await expect(offered('me', NOW)).resolves.toBeNull()
    expect(clearSessionState).not.toHaveBeenCalled()
  })

  it('offers nothing when nothing is stored', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([])

    await expect(offered('me', NOW)).resolves.toBeNull()
  })

  it('deletes a slot older than the age limit instead of offering it', async () => {
    const stale = slot('long-gone', NOW - SESSION_SLOT_MAX_AGE_MS - 1)
    const legacyStale = slot(null, NOW - SESSION_SLOT_MAX_AGE_MS - 1)
    vi.mocked(listSessionStates).mockResolvedValue([stale, legacyStale])

    await expect(offered('me', NOW)).resolves.toBeNull()
    expect(clearSessionState).toHaveBeenCalledWith('long-gone')
    expect(clearSessionState).toHaveBeenCalledWith(null)
  })

  it('keeps and offers a slot exactly at the age limit', async () => {
    const edge = slot('crashed', NOW - SESSION_SLOT_MAX_AGE_MS)
    vi.mocked(listSessionStates).mockResolvedValue([edge])

    await expect(offered('me', NOW)).resolves.toBe(edge)
    expect(clearSessionState).not.toHaveBeenCalled()
  })

  it('logs a prune that fails and still answers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('blocked')
    vi.mocked(clearSessionState).mockRejectedValueOnce(error)
    const fresh = slot('crashed', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([slot('long-gone', 0), fresh])

    await expect(offered('me', NOW)).resolves.toBe(fresh)
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to prune a session slot:', error))
  })
})

// ESCSUITE-283: the tab a departed tab's slot is offered to claims that slot's
// offer lock, `escapeartist-offer:<id>`, until it answers, so a second fresh
// tab opened with it — two tabs opened together after a crash — is not
// offered the same session. Fix round 1: the departed tab's *liveness* lock is
// only probed, never held, so that tab coming back is still itself.
describe('findOfferableSlot claims the departed tab\'s offer (ESCSUITE-283)', () => {
  it('holds the offered slot\'s offer lock, so a second fresh tab is offered the next slot', async () => {
    const older = slot('crashed-early', NOW - 60_000)
    const newer = slot('crashed-late', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([older, newer])

    const first = await findOfferableSlot('fresh-1', NOW)
    await flushLocks()

    expect(first?.slot).toBe(newer)
    expect(fake.isHeld(offerLockName('crashed-late'))).toBe(true)
    await expect(offered('fresh-2', NOW)).resolves.toBe(older)
  })

  it('probes the departed tab\'s liveness lock and leaves it free while its slot is on offer', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('crashed', NOW - 1_000)])

    await findOfferableSlot('fresh-1', NOW)
    await flushLocks()

    expect(fake.log).toEqual(['probe', 'probe'])
    expect(fake.isHeld(tabLockName('crashed'))).toBe(false)
    // The departed tab reloading probes its own id and finds it unused.
    await expect(probeTabLock('crashed', fake.locks)).resolves.toBe('free')
  })

  it('does not claim the offer of a slot whose tab is alive', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('alive', NOW - 1_000)])
    await aliveTab('alive')

    await expect(offered('fresh-1', NOW)).resolves.toBeNull()
    expect(fake.isHeld(offerLockName('alive'))).toBe(false)
  })

  it('offers a second fresh tab nothing when the only slot is already on offer', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('crashed', NOW - 1_000)])

    await findOfferableSlot('fresh-1', NOW)

    await expect(offered('fresh-2', NOW)).resolves.toBeNull()
  })

  it('lets the slot be offered again once the claim is released — an answer, or the offering tab closing', async () => {
    const crashed = slot('crashed', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([crashed])
    const first = await findOfferableSlot('fresh-1', NOW)
    await flushLocks()

    first!.release()
    await flushLocks()

    expect(fake.isHeld(offerLockName('crashed'))).toBe(false)
    await expect(offered('fresh-2', NOW)).resolves.toBe(crashed)
  })

  it('skips a slot another tab claimed after its probe found the tab gone, and offers the next', async () => {
    // The tab-lock probe answers "free" for both tabs; the offer claim is what
    // decides which one is offered the slot.
    const older = slot('crashed-early', NOW - 60_000)
    const newer = slot('crashed-late', NOW - 1_000)
    vi.mocked(listSessionStates).mockImplementation(async () => {
      await claimOfferLock('crashed-late', fake.locks)
      return [older, newer]
    })

    await expect(offered('fresh-2', NOW)).resolves.toBe(older)
    expect(fake.isHeld(offerLockName('crashed-early'))).toBe(true)
  })

  it('claims nothing for this tab\'s own slot or the ownerless shared row, and their release does nothing', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('me', NOW - 1_000)])
    const own = await findOfferableSlot('me', NOW)
    vi.mocked(listSessionStates).mockResolvedValue([slot(null, NOW - 1_000)])
    const legacy = await findOfferableSlot('fresh', NOW)

    expect(fake.log).toEqual([])
    expect(() => own!.release()).not.toThrow()
    expect(() => legacy!.release()).not.toThrow()
  })
})

// ESCSUITE-306: a save this tab declined is another tab's work left in storage
// for that tab to come back to (a tab Chrome's Memory Saver discarded keeps its
// id). That save is not offered to this tab again; a newer save from the same
// tab is (fix round 1: the entry names the save, `{ tabId, timestamp }`), and
// another tab may still be offered it.
describe('findOfferableSlot skips the saves this tab declined (ESCSUITE-306)', () => {
  it('skips a declined save and offers the next newest', async () => {
    const older = slot('crashed-early', NOW - 60_000)
    const declined = slot('discarded', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([older, declined])

    const offer = await findOfferableSlot('me', NOW, [{ tabId: 'discarded', timestamp: NOW - 1_000 }])

    expect(offer?.slot).toBe(older)
    // Skipped before any lock is asked about: neither probed nor claimed.
    expect(fake.isHeld(offerLockName('discarded'))).toBe(false)
  })

  it('offers nothing when the only free slot holds the declined save', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('discarded', NOW - 1_000)])

    await expect(
      findOfferableSlot('me', NOW, [{ tabId: 'discarded', timestamp: NOW - 1_000 }])
    ).resolves.toBeNull()
  })

  it('offers the slot again once its tab has saved newer work into it', async () => {
    const resaved = slot('discarded', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([resaved])

    const offer = await findOfferableSlot('me', NOW, [{ tabId: 'discarded', timestamp: NOW - 60_000 }])

    expect(offer?.slot).toBe(resaved)
  })

  it('does not let another tab\'s declined save hide this slot', async () => {
    const other = slot('other', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([other])

    const offer = await findOfferableSlot('me', NOW, [{ tabId: 'discarded', timestamp: NOW - 1_000 }])

    expect(offer?.slot).toBe(other)
  })

  it('still offers a declined save to another tab, whose list does not name it', async () => {
    const declined = slot('discarded', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([declined])

    const offer = await findOfferableSlot('other-fresh-tab', NOW, [])

    expect(offer?.slot).toBe(declined)
  })

  it('offers this tab\'s own slot even when the list names it: the own-slot rule comes first', async () => {
    const mine = slot('me', NOW - 60_000)
    vi.mocked(listSessionStates).mockResolvedValue([mine])

    const offer = await findOfferableSlot('me', NOW, [{ tabId: 'me', timestamp: NOW - 60_000 }])

    expect(offer?.slot).toBe(mine)
  })

  it('reads this tab\'s own list from sessionStorage when none is passed', async () => {
    const older = slot('crashed-early', NOW - 60_000)
    vi.mocked(listSessionStates).mockResolvedValue([older, slot('discarded', NOW - 1_000)])
    sessionStorage.setItem(
      'escapeartist-declined-slots',
      JSON.stringify([{ tabId: 'discarded', timestamp: NOW - 1_000 }])
    )
    try {
      await expect(offered('me', NOW)).resolves.toBe(older)
    } finally {
      sessionStorage.clear()
    }
  })
})

// Fix round 1: an offer can go stale while the prompt is up — the departed tab
// comes back (a reload after a renderer crash, a tab the browser restores
// lazily) and is offered its own slot. Before either answer touches the slot,
// the answering tab asks whether its owner is alive again.
describe('OfferedSlot.ownerReturned (ESCSUITE-283)', () => {
  it('answers false while the departed tab is still gone, and true once it holds its lock again', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('crashed', NOW - 1_000)])
    const offer = await findOfferableSlot('fresh-1', NOW)

    await expect(offer!.ownerReturned()).resolves.toBe(false)
    await aliveTab('crashed')
    await expect(offer!.ownerReturned()).resolves.toBe(true)
  })

  it('answers false for this tab\'s own slot and the ownerless shared row, without asking', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('me', NOW - 1_000)])
    // This tab holds its own lock, as the autosave does: a probe would say "held".
    await aliveTab('me')
    const own = await findOfferableSlot('me', NOW)
    vi.mocked(listSessionStates).mockResolvedValue([slot(null, NOW - 1_000)])
    const legacy = await findOfferableSlot('fresh', NOW)
    fake.log.length = 0

    await expect(own!.ownerReturned()).resolves.toBe(false)
    await expect(legacy!.ownerReturned()).resolves.toBe(false)
    expect(fake.log).toEqual([])
  })
})

describe('adoptSessionSlot', () => {
  it('stamps the adopted session with now, so the age limit counts from the restore', async () => {
    // Fix round 1 (LOW-2): a 29-day-old slot adopted today must not be pruned
    // tomorrow.
    const nearlyStale = slot('crashed', Date.now() - SESSION_SLOT_MAX_AGE_MS + 60_000)
    const before = Date.now()

    await adoptSessionSlot(nearlyStale, 'me')

    expect(vi.mocked(saveSessionState).mock.calls[0][0].timestamp).toBeGreaterThanOrEqual(before)
  })

  it('rewrites the session under the restoring tab\'s id, then deletes the old row', async () => {
    const crashed = slot('crashed', NOW - 1_000)

    await expect(adoptSessionSlot(crashed, 'me')).resolves.toBe(true)

    expect(saveSessionState).toHaveBeenCalledWith({
      ...crashed.session,
      tabId: 'me',
      timestamp: expect.any(Number),
    })
    expect(clearSessionState).toHaveBeenCalledWith('crashed')
    expect(vi.mocked(saveSessionState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(clearSessionState).mock.invocationCallOrder[0]
    )
  })

  it('deletes the ownerless shared row once it has been adopted', async () => {
    await adoptSessionSlot(slot(null, NOW - 1_000), 'me')

    expect(clearSessionState).toHaveBeenCalledWith(null)
  })

  it('keeps the old row when the rewrite fails, and logs why', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('quota')
    vi.mocked(saveSessionState).mockRejectedValueOnce(error)

    // Not adopted: the caller keeps its claim on the offer (ESCSUITE-283 LOW-1).
    await expect(adoptSessionSlot(slot('crashed', NOW - 1_000), 'me')).resolves.toBe(false)

    expect(clearSessionState).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('Failed to adopt the restored session:', error)
  })

  it('answers false when the old row cannot be deleted, so the caller keeps its claim', async () => {
    // The old row is still in storage: releasing the offer would let another
    // fresh tab adopt a second copy of it (ESCSUITE-283 LOW-1).
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(clearSessionState).mockRejectedValueOnce(new Error('blocked'))

    await expect(adoptSessionSlot(slot('crashed', NOW - 1_000), 'me')).resolves.toBe(false)
  })
})

// ESCSUITE-289: an answer to the prompt reads the offered slot again, because
// its tab can come back, save newer work into it and close again — or start
// fresh and remove it — while the prompt is up.
describe('slotAtAnswer', () => {
  it('answers unchanged when the slot still holds the save that was offered', async () => {
    const offeredSlot = slot('crashed', NOW - 60_000)
    vi.mocked(listSessionStates).mockResolvedValue([slot('other', NOW - 1_000), slot('crashed', NOW - 60_000)])

    await expect(slotAtAnswer(offeredSlot)).resolves.toBe('unchanged')
  })

  it('answers with the newer save when the slot was saved again since', async () => {
    const newer = slot('crashed', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([newer])

    await expect(slotAtAnswer(slot('crashed', NOW - 60_000))).resolves.toBe(newer)
  })

  it('answers removed when the slot is gone, whatever other slots there are', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('other', NOW - 60_000)])

    await expect(slotAtAnswer(slot('crashed', NOW - 60_000))).resolves.toBe('removed')
  })

  it('reads the ownerless shared row by its own key', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('crashed', NOW - 1_000), slot(null, NOW - 60_000)])

    await expect(slotAtAnswer(slot(null, NOW - 60_000))).resolves.toBe('unchanged')
  })
})
