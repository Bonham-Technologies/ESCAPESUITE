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

export interface ServeOptions {
  /** TCP port to bind. `0` picks a free one; read the real port back off the handle. */
  port: number
  /** Interface to bind. Defaults to loopback — there is no auth, so this is deliberate. */
  host?: string
  /** How many renders may run at once. Everything past it queues, FIFO. Default 1. */
  concurrency?: number
  /** How many jobs may wait for a slot before `/render` answers 429. Default 64. */
  maxQueue?: number
  /** Passed straight through to `runJob`, unchanged, for every job. */
  deps: RunJobDeps
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
   * the render timeout, not by this call), then resolves. Idempotent.
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface Limiter {
  /**
   * Runs `task` when a slot frees up. Rejects with `QueueFullError` when there is no room to
   * wait, or `ShuttingDownError` if shutdown got there first — neither enqueues anything.
   */
  run<T>(task: () => Promise<T>): Promise<T>
  readonly inFlight: number
  readonly queued: number
  /** Rejects everything still waiting; running tasks are left alone to finish. */
  shutdown(): void
}

/**
 * FIFO concurrency gate. Deliberately tiny and local: the whole contract is "at most N of these
 * at once, in the order they arrived", and a queue of pending promises is the entirety of it.
 */
function createLimiter(concurrency: number, maxQueue: number): Limiter {
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
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
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
        queue.push({
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
        })
        pump()
      })
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
 * an immediate socket teardown.
 */
function readBody(req: http.IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
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
    req.on('error', reject)
  })
}

function isJsonRequest(req: http.IncomingMessage): boolean {
  const type = req.headers['content-type']
  return typeof type === 'string' && type.split(';')[0].trim().toLowerCase() === 'application/json'
}

/**
 * Starts the HTTP service: the same `runJob` the one-shot CLI drives, behind two routes and a
 * concurrency gate. There is no authentication and none is planned — bind it to loopback or
 * put it behind your own proxy.
 */
export async function startServer(opts: ServeOptions): Promise<ServeHandle> {
  const host = opts.host ?? '127.0.0.1'
  const concurrency = opts.concurrency ?? 1
  const maxQueue = opts.maxQueue ?? DEFAULT_MAX_QUEUE
  const log = opts.log ?? ((line: string) => void process.stderr.write(line + '\n'))
  const limiter = createLimiter(concurrency, maxQueue)

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

  const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    if (res.writableEnded || res.headersSent) return
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

    const raw = await readBody(req)
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

    try {
      // The response is written inside the limiter slot so that "the job finished" and "the
      // client has its answer" are the same moment — which is what close() waits on.
      await limiter.run(async () => {
        const outcome = await runJob(spec, opts.deps)
        // ok:false is still 200: the *request* succeeded, the job did not, and the outcome
        // says which. A 5xx here would tell a caller to retry the HTTP call, which is wrong.
        send(res, 200, withWarnings({ ...outcome }))
      })
      return 200
    } catch (err) {
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
        res.setHeader('allow', 'GET')
        send(res, 405, { error: `method ${method} not allowed on /healthz` })
        return 405
      }
      send(res, 200, {
        ok: true,
        versions: opts.versions,
        inFlight: limiter.inFlight,
        queued: limiter.queued,
        maxQueue,
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
