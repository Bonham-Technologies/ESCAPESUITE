// A Web Locks double: one exclusive lock per name, granted in request order,
// with `ifAvailable` answered against what is held *and* what is queued — the
// shape the spec gives `navigator.locks.request`, which jsdom does not have.
//
// Each request is logged (`'probe'` for an `ifAvailable` request, `'acquire'`
// otherwise) so a test can pin the order the app asks in — the ESCSUITE-227
// probe must be requested before the same tab's own acquisition, or the tab
// would find its own queued request and call itself "held".
//
// A grant is decided synchronously at request time, as the browser's lock
// manager does in its own queue, and the callback runs a microtask later; the
// lock is held until the promise the callback returns settles.
interface Waiting {
  run: () => void
}

interface NameState {
  held: boolean
  queue: Waiting[]
}

export interface FakeLocks {
  /** Pass this wherever the code takes a `LockManager`. */
  locks: LockManager
  /** `'probe'` / `'acquire'`, in the order they were requested. */
  log: string[]
  /** Is the named lock held right now? */
  isHeld: (name: string) => boolean
}

type GrantedCallback = (lock: Lock | null) => unknown

export function createFakeLocks(): FakeLocks {
  const names = new Map<string, NameState>()
  const log: string[] = []

  const stateOf = (name: string): NameState => {
    let state = names.get(name)
    if (!state) {
      state = { held: false, queue: [] }
      names.set(name, state)
    }
    return state
  }

  const grantNext = (state: NameState) => {
    const next = state.queue.shift()
    if (next) next.run()
    else state.held = false
  }

  const request = (
    name: string,
    optionsOrCallback: LockOptions | GrantedCallback,
    maybeCallback?: GrantedCallback
  ): Promise<unknown> => {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback)!
    log.push(options.ifAvailable ? 'probe' : 'acquire')
    const state = stateOf(name)

    if (options.ifAvailable && (state.held || state.queue.length > 0)) {
      return Promise.resolve().then(() => callback(null))
    }

    return new Promise((resolve, reject) => {
      const run = () => {
        state.held = true
        const lock = { name, mode: 'exclusive' } as Lock
        Promise.resolve()
          .then(() => callback(lock))
          .then(
            (value) => {
              resolve(value)
              grantNext(state)
            },
            (error: unknown) => {
              reject(error)
              grantNext(state)
            }
          )
      }
      if (state.held) state.queue.push({ run })
      else run()
    })
  }

  return {
    locks: { request } as unknown as LockManager,
    log,
    isHeld: (name) => stateOf(name).held,
  }
}

/** Let the double's microtask-scheduled grants and releases run. */
export async function flushLocks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
