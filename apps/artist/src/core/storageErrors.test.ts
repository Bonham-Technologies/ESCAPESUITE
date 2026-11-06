import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The once-per-page latch is module state: each case imports a fresh copy, of
// the shared storage module too, so a refusal is recognised by the copy that
// recorded it.
let errors: typeof import('./storageErrors')
let shared: typeof import('@escapesuite/shared/storage')

beforeEach(async () => {
  vi.resetModules()
  shared = await import('@escapesuite/shared/storage')
  errors = await import('./storageErrors')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The error `getDB` rejects with when the browser will not open the database. */
async function refusedOpen(): Promise<unknown> {
  vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  })
  return shared.getDB().catch((error: unknown) => error)
}

// ESCSUITE-414
describe('logStorageFailure', () => {
  it('logs storage the browser will not open once for the page, whoever hits it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = await refusedOpen()
    const second = await refusedOpen()

    errors.logStorageFailure('Failed to read stored files:', first)
    errors.logStorageFailure('Failed to check session:', second)
    errors.logStorageFailure('Failed to process media:', Object.assign(new Error('wrapped'), { cause: first }))

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toMatch(/storage could not be opened/)
    expect(consoleError.mock.calls[0][1]).toBe(first)
  })

  it('logs every other failure as it comes, under its own context', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new DOMException('full', 'QuotaExceededError')

    errors.logStorageFailure('Failed to process media:', failure)
    errors.logStorageFailure('Failed to process media:', failure)

    expect(consoleError.mock.calls).toEqual([
      ['Failed to process media:', failure],
      ['Failed to process media:', failure],
    ])
  })
})

describe('isStorageUnavailable', () => {
  it('is the shared check: a refused open, not a failed write', async () => {
    expect(errors.isStorageUnavailable(await refusedOpen())).toBe(true)
    expect(errors.isStorageUnavailable(new DOMException('full', 'QuotaExceededError'))).toBe(false)
  })
})
