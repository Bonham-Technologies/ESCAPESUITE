import http from 'node:http'
import { collectUnknownKeys, parseJobSpec } from './jobSpec'
import { runJob } from './run'
import type { RunJobDeps } from './run'

/**
 * Biggest job spec the server will read. A spec names *paths*, never payloads, so a real one
 * is a few hundred bytes; a megabyte is already three orders of magnitude of headroom and the
 * only bodies past it are mistakes or attacks.
 */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * How far past the limit an oversize body is drained before the socket is torn down instead.
 * Draining lets the client finish its upload and actually *read* the 413 rather than seeing a
 * reset it cannot explain; the cap stops a deliberate multi-gigabyte upload from being drained
 * forever. Nothing is buffered either way — the bytes past the limit are counted and dropped.
 */
const DRAIN_FACTOR = 8

const JSON_HEADERS = { 'content-type': 'application/json' } as const

/**
 * How many jobs may wait for a slot before the server starts refusing them. Every waiting job
 * is a client holding a connection open for an unknown length of time, so an unbounded queue
 * quietly turns into thousands of parked sockets and renders that finish long after whoever
 * asked for them gave up. Refusing early, loudly, with a Retry-After is the honest answer.
 */
const DEFAULT_MAX_QUEUE = 64

/** How long a client is told to wait before re-POSTing a job the queue had no room for. */
const RETRY_AFTER_SECONDS = 5

/**
 * How long the request line and headers may take to arrive before Node tears the connection
 * down itself with its own 408 — measured on Node 26.7, this (like HEADERS_TIMEOUT_MS) only
 * guards the time *up to* dispatching a request to this server's listener; once the headers
 * have parsed, as they already have by the time readBody is ever called, neither one bounds
 * how long the body itself may then take (close()'s own teardown is what does, during a
 * shutdown — see readBody). A job spec is a few hundred bytes; this is generous for receiving
 * it and nowhere near Node's own 300 s default, which would otherwise let a silent client hold
 * a connection for five minutes before even reaching this listener.
 */
export const REQUEST_TIMEOUT_MS = 30_000

/**
 * How long the request line and headers alone may take to arrive — the classic slowloris
 * window. Shorter than REQUEST_TIMEOUT_MS (Node requires it), because a well-formed client
 * sends its headers in one write; Node's own default is 60 s.
 */
export const HEADERS_TIMEOUT_MS = 10_000

export interface ServeOptions {
  /** TCP port to bind. `0` picks a free one; read the real port back off the handle. */
  port: number
  /** Interface to bind. Defaults to loopback — there is no auth, so this is deliberate. */
  host?: string
  /** How many renders may run at once. Everything past it queues, FIFO. Default 1. */
  concurrency?: number
  /** How many jobs may wait for a slot before `/render` answers 429. Default 64. */
  maxQueue?: number
  /**
   * Passed through to `runJob` for every job — except `handleSignals`, which the server forces
   * to `false` whatever this says, because its own drain owns shutdown.
   */
  deps: RunJobDeps
  /**
   * Which `output.sink` values `POST /render` will accept; anything else is 403 before it is
   * queued. A remote caller picks the sink, so this is the difference between "renders video"
   * and "runs whatever program you name" — see the CLI's `HEADLESS_SINKS`.
   */
  allowedSinks: string[]
  /** Reported by `/healthz`; the kit.json contents when the CLI has one. */
  versions: Record<string, unknown>
  /** Diagnostics sink; defaults to stderr, because stdout belongs to the one-shot CLI. */
  log?: (line: string) => void
}

export interface ServeHandle {
  /** The port actually bound — the interesting case is `port: 0`. */
  port: number
  /**
   * Stops accepting, turns queued jobs away with 503, waits for the in-flight ones (bounded by
   * the render timeout plus whatever the job's own delivery sink budgets for itself — the
   * `webhook` and `command` sinks' `timeoutMs` — not by this call, and not by the render alone).
   * Exception: `s3` sets no timeout of its own, so a stalled upload is bounded only by the AWS
   * SDK's own defaults (no timeout, with retries) — a follow-up, not something this covers.
   * Also tears down, rather than waits on, any request whose body has not finished arriving.
   * Resolves once all of that settles. Idempotent.
   */
  close(): Promise<void>
}

/** Rejection used to turn queued-but-unstarted jobs away once shutdown has begun. */
class ShuttingDownError extends Error {
  constructor() {
    super('server shutting down')
  }
}

/** Rejection for a job that arrived with the queue already full. Nothing is enqueued. */
class QueueFullError extends Error {
  constructor(queued: number) {
    super(`render queue is full (${queued} queued)`)
  }
}

/** Rejection for a queued job whose client hung up before the job ever started. */
class ClientGoneError extends Error {
  constructor() {
    super('client disconnected before the job started')
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface Limited<T> {
  /** Settles with the task, or rejects with `ClientGoneError` if `cancel` got there first. */
  promise: Promise<T>
  /**
   * Takes the task back out of the queue if it has not started. True when it did — false once
   * the task is running, because work in flight is finished, not abandoned.
   */
  cancel(): boolean
}

interface Limiter {
  /**
   * Runs `task` when a slot frees up. Rejects with `QueueFullError` when there is no room to
   * wait, or `ShuttingDownError` if shutdown got there first — neither enqueues anything.
   */
  run<T>(task: () => Promise<T>): Limited<T>
  readonly inFlight: number
  readonly queued: number
  /** Rejects everything still waiting; running tasks are left alone to finish. */
  shutdown(): void
}

/**
 * FIFO concurrency gate. Deliberately tiny and local: the whole contract is "at most N of these
 * at once, in the order they arrived", and a queue of pending promises is the entirety of it.
 */
export function createLimiter(concurrency: number, maxQueue: number): Limiter {
  interface Waiting {
    start: () => void
    reject: (err: unknown) => void
  }

  let active = 0
  let closed = false
  const queue: Waiting[] = []

  const pump = (): void => {
    while (active < concurrency && queue.length > 0) {
      const next = queue.shift() as Waiting
      active++
      next.start()
    }
  }

  return {
    get inFlight() {
      return active
    },
    get queued() {
      return queue.length
    },
    run<T>(task: () => Promise<T>): Limited<T> {
      // Set only for a task that actually made it into the queue; a refused one has nothing
      // to cancel. The executor runs synchronously, so it is assigned before `run` returns.
      let entry: Waiting | undefined

      const promise = new Promise<T>((resolve, reject) => {
        if (closed) {
          reject(new ShuttingDownError())
          return
        }
        // Only *waiting* counts against the bound: a job that can start right now is never
        // refused, however full the queue was a moment ago.
        if (active >= concurrency && queue.length >= maxQueue) {
          reject(new QueueFullError(queue.length))
          return
        }
        entry = {
          reject,
          start: () => {
            // A task that throws synchronously must free its slot like any other, so it is
            // funnelled into the same promise chain rather than escaping as a sync throw.
            let running: Promise<T>
            try {
              running = Promise.resolve(task())
            } catch (err) {
              running = Promise.reject(err)
            }
            void running.then(resolve, reject).finally(() => {
              active--
              pump()
            })
          },
        }
        queue.push(entry)
        pump()
      })

      return {
        promise,
        cancel: () => {
          if (entry === undefined) return false
          // A started task has already been shifted off the queue, so this is also the test
          // for "too late": indexOf is -1 and the task is left alone to finish.
          const index = queue.indexOf(entry)
          if (index === -1) return false
          queue.splice(index, 1)
          entry.reject(new ClientGoneError())
          return true
        },
      }
    },
    shutdown() {
      closed = true
      while (queue.length > 0) {
        const waiting = queue.shift() as Waiting
        waiting.reject(new ShuttingDownError())
      }
    },
  }
}

/**
 * Reads the request body, capped at `MAX_BODY_BYTES`.
 *
 * Returns `undefined` when the body was too big — see DRAIN_FACTOR for why that is not simply
 * an immediate socket teardown — and `BODY_GONE` when it was going to fit but never finished
 * arriving at all: `close()` force-ending a request still parked here during shutdown, or the
 * client dropping the connection. (Measured on Node 26.7: `requestTimeout`/`headersTimeout`
 * only guard the time *up to* dispatching a request to this listener — once headers have
 * parsed, as they already have by the time this is called, neither one bounds how long the
 * body itself may then take, so close()'s own teardown is the only thing that does outside a
 * client simply giving up.) Either way this is not the same failure as "too big" and must not
 * be answered the same way.
 */
function readBody(req: http.IncomingMessage): Promise<string | undefined | typeof BODY_GONE> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        over = true
        // Drop what was buffered: this body is not going to be parsed either way.
        chunks.length = 0
        if (size > MAX_BODY_BYTES * DRAIN_FACTOR) {
          req.destroy()
          resolve(undefined)
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(over ? undefined : Buffer.concat(chunks).toString('utf8')))
    // Any failure reading the body before it finishes — overwhelmingly a connection reset,
    // which is how Node reports a client giving up mid-body on this object, before 'close'
    // ever fires — is gone, not broken: it settles the same way the close()-triggered and
    // oversized-body cases do, never as a stream error to log and fail the request over.
    req.on('error', () => resolve(BODY_GONE))
    // 'close' fires after a normal 'end' too, but by then the promise has already settled and
    // this is a no-op. `req.complete` is Node's own record of whether 'end' actually happened —
    // false here means the body was destroyed before it finished, for any reason, and the
    // oversized-body path above has already settled its own cases before 'close' can.
    req.on('close', () => {
      if (!req.complete) resolve(BODY_GONE)
    })
  })
}

/**
 * Distinguishes "the body was never going to finish" from "the body was too big" — both of
 * which `readBody` used to collapse into a single `undefined`. A request that settles with
 * this is already dead (its response was ended by `close()`'s teardown, or the client itself
 * gave up) and must not be sent another response at all, let alone the size-specific 413 an
 * oversized body gets.
 */
export const BODY_GONE = Symbol('body-gone')

function isJsonRequest(req: http.IncomingMessage): boolean {
  const type = req.headers['content-type']
  return typeof type === 'string' && type.split(';')[0].trim().toLowerCase() === 'application/json'
}

/**
 * Starts the HTTP service: the same `runJob` the one-shot CLI drives, behind two routes and a
 * concurrency gate. There is no authentication and none is planned — bind it to loopback or
 * put it behind your own proxy. `allowedSinks` is the one thing standing between a reachable
 * port and arbitrary command execution, so it is required rather than defaulted.
 */
export async function startServer(opts: ServeOptions): Promise<ServeHandle> {
  const host = opts.host ?? '127.0.0.1'
  const concurrency = opts.concurrency ?? 1
  const maxQueue = opts.maxQueue ?? DEFAULT_MAX_QUEUE
  const log = opts.log ?? ((line: string) => void process.stderr.write(line + '\n'))
  const limiter = createLimiter(concurrency, maxQueue)
  const allowedSinks = [...opts.allowedSinks]
  // The drain below owns shutdown, so Playwright must not race it by killing the browser (and,
  // on SIGINT, the process) the moment the first signal lands. Forced here rather than left to
  // the caller: close()'s promise to finish in-flight renders is only true if this holds.
  const runDeps: RunJobDeps = { ...opts.deps, handleSignals: false }

  let closing = false
  let closePromise: Promise<void> | undefined

  // Requests still being served, response included — what shutdown actually has to wait for.
  // The limiter only knows about renders; a 400 or a queued job's 503 is in flight too.
  let openRequests = 0
  let onIdle: (() => void) | undefined

  const requestDone = (): void => {
    openRequests--
    if (openRequests === 0 && onIdle) onIdle()
  }

  // Requests currently waiting on readBody — dispatched, but not yet parsed, so neither the
  // limiter nor a route handler knows about them. Nothing bounds how long a client can
  // withhold the rest of a body, so close() singles these out rather than waiting on them.
  const bodiesInFlight = new Set<{ req: http.IncomingMessage; res: http.ServerResponse }>()

  const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    if (res.writableEnded || res.headersSent || res.destroyed) return
    const headers: Record<string, string> = { ...JSON_HEADERS }
    // Once shutdown has begun, no socket may be kept alive: an idle keep-alive connection
    // would hold the server open and `close()` would never resolve.
    if (closing) headers.connection = 'close'
    res.writeHead(status, headers)
    res.end(JSON.stringify(body) + '\n')
  }

  const handleRender = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<number> => {
    if (!isJsonRequest(req)) {
      send(res, 415, { error: 'content-type must be application/json' })
      return 415
    }

    const inFlight = { req, res }
    bodiesInFlight.add(inFlight)
    let raw: string | undefined | typeof BODY_GONE
    try {
      raw = await readBody(req)
    } finally {
      bodiesInFlight.delete(inFlight)
    }

    if (raw === BODY_GONE) {
      // Either close() already answered this one (see bodiesInFlight) while its body was
      // still arriving — writableEnded is true, and its real status is worth logging — or the
      // body is simply gone with nothing ever sent (the client disconnected on its own): 499
      // mirrors how an abandoned queued job is logged below, rather than a stray, misleading
      // 413.
      return res.writableEnded ? res.statusCode : 499
    }

    if (raw === undefined) {
      send(res, 413, { error: `job spec must be at most ${MAX_BODY_BYTES} bytes` })
      return 413
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      send(res, 400, { error: 'request body is not valid JSON' })
      return 400
    }

    // A misspelled optional field parses fine and is then ignored, so the render silently does
    // something other than what was asked. Reported either way, never a reason to refuse.
    const warnings = collectUnknownKeys(json)
    const withWarnings = <T extends object>(body: T): T => (warnings.length > 0 ? { ...body, warnings } : body)

    let spec
    try {
      spec = parseJobSpec(json)
    } catch (err) {
      send(res, 400, withWarnings({ error: messageOf(err) }))
      return 400
    }

    // Decided before anything is queued: a sink this server does not enable is a refusal, not
    // a job that fails later. The caller picks the sink, so this is the whole security boundary
    // between "renders video" and "runs the program you named".
    if (!allowedSinks.includes(spec.output.sink)) {
      send(res, 403, withWarnings({
        error: `sink "${spec.output.sink}" is not enabled on this server (HEADLESS_SINKS)`,
      }))
      return 403
    }

    // The response is written inside the limiter slot so that "the job finished" and "the
    // client has its answer" are the same moment — which is what close() waits on.
    const limited = limiter.run(async () => {
      const outcome = await runJob(spec, runDeps)
      // ok:false is still 200: the *request* succeeded, the job did not, and the outcome
      // says which. A 5xx here would tell a caller to retry the HTTP call, which is wrong.
      send(res, 200, withWarnings({ ...outcome }))
    })

    // A client that gives up while its job is still waiting has it taken back out of the queue:
    // the render could only ever finish into a socket nobody is reading, and the slot is better
    // spent on a caller still listening. Once it has *started* it is left to finish — the job is
    // idempotent by jobId, and a half-written output is worse than a wasted one.
    //
    // `res` rather than `req`: `req` emits 'close' the moment its body has been read, on every
    // request, so it says nothing about whether the client is still there. `res` emits 'close'
    // exactly once either way, and `writableEnded` is what separates "answered" from "gone".
    // ('aborted' on `req` cannot fire here — the body was fully read to get this far.)
    let abandoned = false
    const onClientGone = (): void => {
      if (res.writableEnded || !limited.cancel()) return
      abandoned = true
      log('POST /render aborted by client')
    }
    res.on('close', onClientGone)

    try {
      await limited.promise
      return 200
    } catch (err) {
      // 499, nginx's "client closed request": nobody will read it, it is for the access log.
      if (abandoned) return 499
      if (err instanceof ShuttingDownError) {
        send(res, 503, { error: err.message })
        return 503
      }
      if (err instanceof QueueFullError) {
        res.setHeader('retry-after', String(RETRY_AFTER_SECONDS))
        send(res, 429, { error: err.message })
        return 429
      }
      throw err
    } finally {
      res.off('close', onClientGone)
    }
  }

  const route = async (req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<number> => {
    const method = req.method ?? 'GET'

    // `server.close()` stops new *connections*; a keep-alive one that was already open can
    // still pipeline a request into a server that is draining. Turn it away with the same
    // answer a queued job gets, rather than starting a render nothing will wait for.
    if (closing) {
      send(res, 503, { error: 'server shutting down' })
      return 503
    }

    if (pathname === '/healthz') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD')
        send(res, 405, { error: `method ${method} not allowed on /healthz` })
        return 405
      }
      send(res, 200, {
        ok: true,
        versions: opts.versions,
        inFlight: limiter.inFlight,
        queued: limiter.queued,
        maxQueue,
        allowedSinks,
      })
      return 200
    }

    if (pathname === '/render') {
      if (method !== 'POST') {
        res.setHeader('allow', 'POST')
        send(res, 405, { error: `method ${method} not allowed on /render` })
        return 405
      }
      return handleRender(req, res)
    }

    send(res, 404, { error: `not found: ${pathname}` })
    return 404
  }

  const server = http.createServer((req, res) => {
    const startedAt = Date.now()
    openRequests++
    const method = req.method ?? 'GET'
    // A request target URL is too malformed to parse is the client's problem, not a reason to
    // throw out of the request listener — which would be an uncaught exception, i.e. the whole
    // server gone. Left unparsed it simply matches no route and gets a 404.
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      pathname = req.url ?? '/'
    }

    void route(req, res, pathname)
      .catch((err: unknown) => {
        // Nothing a handler can do may take the process down: a render server that dies on one
        // bad request takes every other in-flight job with it.
        log(`error: ${method} ${pathname}: ${messageOf(err)}`)
        send(res, 500, { error: messageOf(err) })
        return 500
      })
      .then((status) => {
        log(`${method} ${pathname} ${status} ${Date.now() - startedAt}ms`)
      })
      .finally(requestDone)
      // Last line of defence: even a throwing `log` must not become an unhandled rejection.
      .catch(() => {})
  })

  // Node's own defaults (300 s / 60 s) would let a silent or trickling client hold a
  // connection for minutes; a job spec is a few hundred bytes and has no business taking that
  // long to arrive at all.
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = HEADERS_TIMEOUT_MS

  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown): void => reject(err)
    server.once('error', onError)
    server.listen(opts.port, host, () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
  server.on('error', (err) => {
    log(`error: server: ${messageOf(err)}`)
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : opts.port

  const close = async (): Promise<void> => {
    closing = true
    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    // Connections parked between requests would otherwise keep the server open forever.
    server.closeIdleConnections()
    limiter.shutdown()

    // A request whose body has not finished arriving cannot be waited on: nothing queued it,
    // and nothing bounds how long a client can withhold the rest. Each one is force-ended here
    // instead of kept alive until it either finishes or times out on its own — 408 while the
    // response can still carry one, otherwise just the connection going away. `send` is a no-op
    // on a response already destroyed or ended, so there is no guard to write here by hand; it
    // also sets `connection: close`, same as every other shutdown-time response. Not awaited
    // one by one; readBody's own 'close'/'error' handling settles it either way (resolving
    // BODY_GONE), which still lets the openRequests wait below reach zero.
    for (const { req, res } of bodiesInFlight) {
      send(res, 408, { error: 'request body did not finish arriving before shutdown' })
      req.destroy()
    }

    if (openRequests > 0) {
      await new Promise<void>((resolve) => {
        onIdle = resolve
      })
    }
    server.closeIdleConnections()
    await closed
  }

  return {
    port,
    close: () => {
      closePromise ??= close()
      return closePromise
    },
  }
}
