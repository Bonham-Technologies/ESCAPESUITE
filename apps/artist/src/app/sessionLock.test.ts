// The per-tab locks (ESCSUITE-274), against a Web Locks double: each tab holds
// `escapeartist-tab:<its id>` for its lifetime, and the startup check asks
// whether the tab that wrote a slot is still alive before offering it.
//
// jsdom has no `navigator.locks`, so the cases that pass no `locks` argument
// are the "no Web Locks at all" ones — the tab behaves as if it were alone.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { claimTabLock, holdTabLock, probeTabLock, tabLockName } from './sessionLock'
import { createFakeLocks, flushLocks } from '../test/doubles/locks'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tabLockName', () => {
  it('names one lock per tab id', () => {
    expect(tabLockName('abc')).toBe('escapeartist-tab:abc')
  })
})

describe('probeTabLock', () => {
  it('answers free when the tab is not alive', async () => {
    const { locks } = createFakeLocks()

    await expect(probeTabLock('crashed', locks)).resolves.toBe('free')
  })

  it('answers held while that tab is alive', async () => {
    const { locks } = createFakeLocks()
    holdTabLock('alive', locks)
    await flushLocks()

    await expect(probeTabLock('alive', locks)).resolves.toBe('held')
  })

  it('answers for that tab only: another tab being alive does not make this one held', async () => {
    const { locks } = createFakeLocks()
    holdTabLock('alive', locks)
    await flushLocks()

    await expect(probeTabLock('crashed', locks)).resolves.toBe('free')
  })

  it('does not take the lock: the tab that asks for it after a probe still gets it', async () => {
    const { locks, isHeld } = createFakeLocks()
    await probeTabLock('crashed', locks)
    await flushLocks()

    expect(isHeld(tabLockName('crashed'))).toBe(false)
  })

  it('answers free when the browser rejects the probe, and logs why', async () => {
    // Unusable locks mean a lone tab: a session is still offered rather than
    // never at all.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new DOMException('opaque origin', 'SecurityError')
    const locks = { request: vi.fn(() => Promise.reject(error)) } as unknown as LockManager

    await expect(probeTabLock('crashed', locks)).resolves.toBe('free')
    expect(consoleError).toHaveBeenCalledWith('Failed to probe a tab lock:', error)
  })

  it('answers free where the browser has no Web Locks', async () => {
    expect(navigator.locks).toBeUndefined()

    await expect(probeTabLock('crashed')).resolves.toBe('free')
  })
})

describe('holdTabLock', () => {
  it('holds the lock until the returned function runs', async () => {
    const { locks, isHeld } = createFakeLocks()

    const release = holdTabLock('mine', locks)
    await flushLocks()
    expect(isHeld(tabLockName('mine'))).toBe(true)
    await flushLocks()
    expect(isHeld(tabLockName('mine'))).toBe(true)

    release()
    await flushLocks()
    expect(isHeld(tabLockName('mine'))).toBe(false)
  })

  it('waits behind a holder of the same name, and lets go at once if released first', async () => {
    // StrictMode's cleanup-then-remount: a request released before it was
    // granted must not keep the lock once it is handed it.
    const { locks, isHeld } = createFakeLocks()
    const releaseFirst = holdTabLock('mine', locks)
    const releaseStale = holdTabLock('mine', locks)
    await flushLocks()

    releaseStale()
    releaseFirst()
    await flushLocks()

    expect(isHeld(tabLockName('mine'))).toBe(false)
  })

  it('does nothing where the browser has no Web Locks', () => {
    const release = holdTabLock('mine')

    expect(() => release()).not.toThrow()
  })

  it('logs a request the browser rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new DOMException('opaque origin', 'SecurityError')
    const locks = { request: vi.fn(() => Promise.reject(error)) } as unknown as LockManager

    holdTabLock('mine', locks)
    await flushLocks()

    expect(consoleError).toHaveBeenCalledWith('Failed to hold this tab\'s lock:', error)
  })
})

// ESCSUITE-283: a departed tab's lock is claimed by the tab its slot is offered
// to, from the offer until the answer, so a second fresh tab's request for it
// is answered "held" and that tab moves on.
describe('claimTabLock', () => {
  it('takes a departed tab\'s lock and holds it until the returned function runs', async () => {
    const { locks, isHeld, log } = createFakeLocks()

    const release = await claimTabLock('crashed', locks)
    expect(release).toEqual(expect.any(Function))
    expect(log).toEqual(['probe'])
    await flushLocks()
    expect(isHeld(tabLockName('crashed'))).toBe(true)

    release!()
    await flushLocks()
    expect(isHeld(tabLockName('crashed'))).toBe(false)
  })

  it('answers null, and holds nothing, while that tab is alive', async () => {
    const { locks } = createFakeLocks()
    const releaseAlive = holdTabLock('alive', locks)
    await flushLocks()

    await expect(claimTabLock('alive', locks)).resolves.toBeNull()

    // The live tab closing frees its lock: the failed claim queued nothing.
    releaseAlive()
    await flushLocks()
    await expect(probeTabLock('alive', locks)).resolves.toBe('free')
  })

  it('answers null to the second of two claims on the same lock', async () => {
    // Two fresh tabs asking at once: the first request is granted, the second
    // is answered against it.
    const { locks } = createFakeLocks()

    const [first, second] = await Promise.all([claimTabLock('crashed', locks), claimTabLock('crashed', locks)])

    expect(first).toEqual(expect.any(Function))
    expect(second).toBeNull()
  })

  it('answers as a lone tab when the browser rejects the claim, and logs why', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new DOMException('opaque origin', 'SecurityError')
    const locks = { request: vi.fn(() => Promise.reject(error)) } as unknown as LockManager

    const release = await claimTabLock('crashed', locks)

    expect(release).toEqual(expect.any(Function))
    expect(() => release!()).not.toThrow()
    expect(consoleError).toHaveBeenCalledWith('Failed to claim a tab lock:', error)
  })

  it('answers as a lone tab where the browser has no Web Locks', async () => {
    expect(navigator.locks).toBeUndefined()

    const release = await claimTabLock('crashed')

    expect(release).toEqual(expect.any(Function))
    expect(() => release!()).not.toThrow()
  })
})
