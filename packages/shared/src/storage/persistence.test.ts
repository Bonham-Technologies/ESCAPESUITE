// ESCSUITE-468: asking the browser to keep stored recordings and projects
// (`navigator.storage.persist()`), and reading back whether it agreed
// (`navigator.storage.persisted()`). Every way the API can answer is driven
// here: granted, denied, missing outright and throwing. Each test loads a
// fresh copy of the module, because "at most once per session" is module
// state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Persistence = typeof import('./persistence')

let persistence: Persistence

beforeEach(async () => {
  vi.resetModules()
  persistence = await import('./persistence')
})

afterEach(() => {
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
})

/**
 * A `navigator.storage` whose `persist()` answers `grant`, and whose
 * `persisted()` reports what was granted so far, as a browser's does.
 */
function installStorage(grant: boolean | (() => Promise<boolean>), initiallyPersisted = false) {
  let persisted = initiallyPersisted
  const storage = {
    persist: vi.fn(async () => {
      const answer = typeof grant === 'function' ? await grant() : grant
      if (answer) persisted = true
      return answer
    }),
    persisted: vi.fn(async () => persisted),
  }
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true })
  return storage
}

describe('readStoragePersisted', () => {
  it('answers what navigator.storage.persisted() says, and never asks', async () => {
    const storage = installStorage(true, true)

    expect(await persistence.readStoragePersisted()).toBe(true)
    expect(persistence.getStoragePersisted()).toBe(true)
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('answers false when the browser has not granted it', async () => {
    installStorage(true)

    expect(await persistence.readStoragePersisted()).toBe(false)
    expect(persistence.getStoragePersisted()).toBe(false)
  })

  it('answers false with no navigator.storage at all', async () => {
    expect(await persistence.readStoragePersisted()).toBe(false)
  })

  it('answers false when navigator.storage has no persisted()', async () => {
    Object.defineProperty(navigator, 'storage', { value: {}, configurable: true })

    expect(await persistence.readStoragePersisted()).toBe(false)
  })

  it('answers false when persisted() rejects', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: vi.fn().mockRejectedValue(new DOMException('denied', 'SecurityError')) },
      configurable: true,
    })

    expect(await persistence.readStoragePersisted()).toBe(false)
  })

  it('answers false when persisted() throws synchronously', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: {
        persisted: () => {
          throw new TypeError('Illegal invocation')
        },
      },
      configurable: true,
    })

    expect(await persistence.readStoragePersisted()).toBe(false)
  })

  it('answers false when persisted() resolves something other than true', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    expect(await persistence.readStoragePersisted()).toBe(false)
  })
})

describe('requestStoragePersistence', () => {
  it('asks once when granted, and reports the re-read state', async () => {
    const storage = installStorage(true)

    expect(await persistence.requestStoragePersistence()).toBe(true)
    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(storage.persisted).toHaveBeenCalled()
    expect(persistence.getStoragePersisted()).toBe(true)
  })

  it('reports false when denied', async () => {
    const storage = installStorage(false)

    expect(await persistence.requestStoragePersistence()).toBe(false)
    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(persistence.getStoragePersisted()).toBe(false)
  })

  it('asks at most once per session: later saves only re-read the state', async () => {
    const storage = installStorage(false)

    await persistence.requestStoragePersistence()
    await persistence.requestStoragePersistence()
    expect(await persistence.requestStoragePersistence()).toBe(false)

    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(storage.persisted).toHaveBeenCalledTimes(3)
  })

  it('asks once even when two saves land together', async () => {
    const storage = installStorage(true)

    await Promise.all([persistence.requestStoragePersistence(), persistence.requestStoragePersistence()])

    expect(storage.persist).toHaveBeenCalledTimes(1)
  })

  it('reports false, without throwing, with no navigator.storage at all', async () => {
    await expect(persistence.requestStoragePersistence()).resolves.toBe(false)
    expect(persistence.getStoragePersisted()).toBe(false)
  })

  it('reports false, without throwing, when navigator.storage has no persist()', async () => {
    const persisted = vi.fn().mockResolvedValue(false)
    Object.defineProperty(navigator, 'storage', { value: { persisted }, configurable: true })

    await expect(persistence.requestStoragePersistence()).resolves.toBe(false)
    expect(persisted).toHaveBeenCalled()
  })

  it('reports false, without throwing, when persist() rejects', async () => {
    const storage = installStorage(() => Promise.reject(new DOMException('no', 'NotAllowedError')))

    await expect(persistence.requestStoragePersistence()).resolves.toBe(false)
    expect(storage.persist).toHaveBeenCalledTimes(1)
  })

  it('reports false, without throwing, when persist() throws synchronously', async () => {
    const persisted = vi.fn().mockResolvedValue(false)
    Object.defineProperty(navigator, 'storage', {
      value: {
        persist: () => {
          throw new TypeError('Illegal invocation')
        },
        persisted,
      },
      configurable: true,
    })

    await expect(persistence.requestStoragePersistence()).resolves.toBe(false)
    expect(persisted).toHaveBeenCalled()
  })
})

describe('subscribers', () => {
  it('starts unknown, then hears every state read', async () => {
    installStorage(true)
    const listener = vi.fn()
    const unsubscribe = persistence.subscribeStoragePersisted(listener)

    expect(persistence.getStoragePersisted()).toBeNull()
    await persistence.readStoragePersisted()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(persistence.getStoragePersisted()).toBe(false)

    await persistence.requestStoragePersistence()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(persistence.getStoragePersisted()).toBe(true)

    unsubscribe()
    await persistence.readStoragePersisted()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not call subscribers when a read changes nothing', async () => {
    installStorage(false)
    const listener = vi.fn()
    persistence.subscribeStoragePersisted(listener)

    await persistence.readStoragePersisted()
    await persistence.readStoragePersisted()

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('the sentences', () => {
  it('says what each state means for the user', () => {
    expect(persistence.storagePersistenceMessage(true)).toBe('Protected from automatic clean-up')
    expect(persistence.storagePersistenceMessage(false)).toBe(
      'Your browser may delete these if it runs low on space; download what you want to keep.'
    )
  })
})
