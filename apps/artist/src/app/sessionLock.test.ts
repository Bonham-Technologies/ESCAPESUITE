// The session owner lock (ESCSUITE-227), against a Web Locks double: one tab
// at a time owns the autosave slot, and a tab can ask whether another one does.
//
// jsdom has no `navigator.locks`, so the cases that pass no `locks` argument
// are the "no Web Locks at all" ones — the tab behaves as if it were alone.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { acquireSessionOwnership, probeSessionOwner, SESSION_LOCK_NAME } from './sessionLock'
import { createFakeLocks, flushLocks } from '../test/doubles/locks'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('probeSessionOwner', () => {
  it('answers free when no tab holds the session lock', async () => {
    const { locks } = createFakeLocks()

    await expect(probeSessionOwner(locks)).resolves.toBe('free')
  })

  it('answers held while another tab owns the session', async () => {
    const { locks } = createFakeLocks()
    acquireSessionOwnership(() => {}, locks)
    await flushLocks()

    await expect(probeSessionOwner(locks)).resolves.toBe('held')
  })

  it('does not take the lock: an owner that asks after a probe still gets it', async () => {
    const { locks, isHeld } = createFakeLocks()
    await probeSessionOwner(locks)
    await flushLocks()

    expect(isHeld(SESSION_LOCK_NAME)).toBe(false)
  })

  it('answers free where the browser has no Web Locks', async () => {
    // jsdom: `navigator.locks` is undefined, so the default argument is too.
    expect(navigator.locks).toBeUndefined()

    await expect(probeSessionOwner()).resolves.toBe('free')
  })
})

describe('acquireSessionOwnership', () => {
  it('calls onAcquired once when the lock is granted, and holds the lock', async () => {
    const { locks, isHeld } = createFakeLocks()
    const onAcquired = vi.fn()

    acquireSessionOwnership(onAcquired, locks)
    await flushLocks()

    expect(onAcquired).toHaveBeenCalledTimes(1)
    expect(isHeld(SESSION_LOCK_NAME)).toBe(true)

    // Still held later: the callback's promise is open until release.
    await flushLocks()
    expect(isHeld(SESSION_LOCK_NAME)).toBe(true)
    expect(onAcquired).toHaveBeenCalledTimes(1)
  })

  it('releases the lock when the returned function runs', async () => {
    const { locks, isHeld } = createFakeLocks()
    const release = acquireSessionOwnership(() => {}, locks)
    await flushLocks()

    release()
    await flushLocks()

    expect(isHeld(SESSION_LOCK_NAME)).toBe(false)
    await expect(probeSessionOwner(locks)).resolves.toBe('free')
  })

  it('waits behind the owner, and takes over when the owner lets go', async () => {
    const { locks } = createFakeLocks()
    const releaseFirst = acquireSessionOwnership(() => {}, locks)
    const second = vi.fn()
    acquireSessionOwnership(second, locks)
    await flushLocks()

    expect(second).not.toHaveBeenCalled()

    releaseFirst()
    await flushLocks()

    expect(second).toHaveBeenCalledTimes(1)
  })

  it('never calls onAcquired for a request released before it was granted', async () => {
    // StrictMode's cleanup-then-remount, or an unmount while another tab
    // still owns the session: the queued request must not later claim the
    // slot for a hook that is gone, and must hand the lock straight on.
    const { locks, isHeld } = createFakeLocks()
    const releaseOwner = acquireSessionOwnership(() => {}, locks)
    const stale = vi.fn()
    const releaseStale = acquireSessionOwnership(stale, locks)
    const next = vi.fn()
    acquireSessionOwnership(next, locks)
    await flushLocks()

    releaseStale()
    releaseOwner()
    await flushLocks()

    expect(stale).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    expect(isHeld(SESSION_LOCK_NAME)).toBe(true)
  })

  it('runs onAcquired at once where the browser has no Web Locks', () => {
    const onAcquired = vi.fn()

    const release = acquireSessionOwnership(onAcquired)

    expect(onAcquired).toHaveBeenCalledTimes(1)
    expect(() => release()).not.toThrow()
  })

  it('logs a request the browser rejects rather than leaving it unhandled', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new DOMException('gone', 'AbortError')
    const locks = { request: vi.fn(() => Promise.reject(error)) } as unknown as LockManager
    const onAcquired = vi.fn()

    acquireSessionOwnership(onAcquired, locks)
    await flushLocks()

    expect(onAcquired).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('Failed to acquire the session lock:', error)
  })
})
