// Which saved session the startup prompt offers (ESCSUITE-274), and how a
// restored one changes hands.
//
// Every tab keeps its own slot, and every tab holds `escapeartist-tab:<id>` for
// its lifetime, so a slot whose tab lock is free is a session nobody is still
// working in — a tab that closed or crashed. Storage is the App suite's
// recording double; the locks are the Web Locks double the ESCSUITE-227 suites
// use, installed on `navigator` the way the browser provides it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { adoptSessionSlot, findOfferableSlot } from './sessionSlots'
import { holdTabLock } from './sessionLock'
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

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(newer)
  })

  it('skips a slot whose tab is still alive and offers the next newest', async () => {
    const crashed = slot('crashed', NOW - 60_000)
    const live = slot('alive', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([crashed, live])
    await aliveTab('alive')

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(crashed)
  })

  it('offers nothing when every slot belongs to a live tab', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('alive', NOW - 1_000)])
    await aliveTab('alive')

    await expect(findOfferableSlot('me', NOW)).resolves.toBeNull()
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

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(mine)
    expect(fake.log).toEqual([])
  })

  it('offers nothing when this tab\'s own slot holds no media, rather than another tab\'s slot over it', async () => {
    // Restoring the other slot would adopt it over this tab's own work.
    vi.mocked(listSessionStates).mockResolvedValue([
      slot('me', NOW - 60_000, { sourceVideos: [] }),
      slot('crashed', NOW - 1_000),
    ])

    await expect(findOfferableSlot('me', NOW)).resolves.toBeNull()
  })

  it('offers the newest free slot when this tab has none of its own', async () => {
    const older = slot('closed-early', NOW - 60_000)
    const newer = slot('closed-late', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([older, newer])

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(newer)
  })

  it('treats this tab\'s own slot past the age limit as gone, and offers the next', async () => {
    const other = slot('crashed', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([slot('me', NOW - SESSION_SLOT_MAX_AGE_MS - 1), other])

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(other)
    expect(clearSessionState).toHaveBeenCalledWith('me')
  })

  it('offers this tab\'s own slot — a reload — without probing a lock it is about to hold', async () => {
    const mine = slot('me', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([mine])
    // This tab queues for its own lock as the editor mounts; a probe would
    // find that and call the reload "another tab".
    holdTabLock('me', fake.locks)

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(mine)
    expect(fake.log).toEqual(['acquire'])
  })

  it('offers the row an older build shared between tabs as a slot with no owner, without a probe', async () => {
    const legacy = slot(null, NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([legacy])

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(legacy)
    expect(fake.log).toEqual([])
  })

  it('does not offer a slot with no media in it', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slot('crashed', NOW - 1_000, { sourceVideos: [] })])

    await expect(findOfferableSlot('me', NOW)).resolves.toBeNull()
    expect(clearSessionState).not.toHaveBeenCalled()
  })

  it('offers nothing when nothing is stored', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([])

    await expect(findOfferableSlot('me', NOW)).resolves.toBeNull()
  })

  it('deletes a slot older than the age limit instead of offering it', async () => {
    const stale = slot('long-gone', NOW - SESSION_SLOT_MAX_AGE_MS - 1)
    const legacyStale = slot(null, NOW - SESSION_SLOT_MAX_AGE_MS - 1)
    vi.mocked(listSessionStates).mockResolvedValue([stale, legacyStale])

    await expect(findOfferableSlot('me', NOW)).resolves.toBeNull()
    expect(clearSessionState).toHaveBeenCalledWith('long-gone')
    expect(clearSessionState).toHaveBeenCalledWith(null)
  })

  it('keeps and offers a slot exactly at the age limit', async () => {
    const edge = slot('crashed', NOW - SESSION_SLOT_MAX_AGE_MS)
    vi.mocked(listSessionStates).mockResolvedValue([edge])

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(edge)
    expect(clearSessionState).not.toHaveBeenCalled()
  })

  it('logs a prune that fails and still answers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('blocked')
    vi.mocked(clearSessionState).mockRejectedValueOnce(error)
    const fresh = slot('crashed', NOW - 1_000)
    vi.mocked(listSessionStates).mockResolvedValue([slot('long-gone', 0), fresh])

    await expect(findOfferableSlot('me', NOW)).resolves.toBe(fresh)
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to prune a session slot:', error))
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

    await adoptSessionSlot(crashed, 'me')

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

    await adoptSessionSlot(slot('crashed', NOW - 1_000), 'me')

    expect(clearSessionState).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('Failed to adopt the restored session:', error)
  })
})
