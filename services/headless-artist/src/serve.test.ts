import http from 'node:http'
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startServer } from './serve'
import type { ServeOptions, ServeHandle } from './serve'
import { runJob } from './run'
import type { RunJobDeps } from './run'
import type { RenderOutcome } from './types'

// Chromium is out of scope here: these tests are about routing, limits and shutdown.
vi.mock('./run')

const VERSIONS = { kitVersion: 'kit-test', engineVersion: 'engine-test' }

/** What the CLI hands the server by default: everything except the command sink. */
const ALLOWED_SINKS = ['volume', 'webhook', 's3']

const DEPS: RunJobDeps = {
  bundlePath: '/nowhere/headless.html',
  versions: VERSIONS,
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function outcomeFor(jobId: string): RenderOutcome {
  return { jobId, ok: true, outputLocation: `/out/${jobId}.mp4`, durationMs: 5 }
}

function validSpec(jobId = 'job-1', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId,
    input: { manifest: { path: '/tmp/manifest.json' } },
    options: { format: 'mp4' },
    output: { sink: 'volume', config: { dir: '/tmp/out' } },
    ...overrides,
  }
}

const servers: ServeHandle[] = []
const sockets: net.Socket[] = []
let logs: string[]
let base: string

async function start(overrides: Partial<ServeOptions> = {}): Promise<ServeHandle> {
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    deps: DEPS,
    allowedSinks: ALLOWED_SINKS,
    versions: VERSIONS,
    log: (line) => logs.push(line),
    ...overrides,
  })
  servers.push(server)
  base = `http://127.0.0.1:${server.port}`
  return server
}

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

function postSpec(spec: Record<string, unknown>): Promise<Response> {
  return post(JSON.stringify(spec))
}

interface RawRequest {
  /** The response status, or `0` when the socket died before one arrived. */
  status: Promise<number>
  /** Hangs up the way a client that gave up does — a reset, not a graceful close. */
  destroy(): void
}

/**
 * A `POST /render` over `node:http` rather than `fetch`, because these tests need to destroy
 * the socket at a chosen moment and read the server's reaction to it.
 */
function postRaw(spec: Record<string, unknown>): RawRequest {
  const body = JSON.stringify(spec)
  const req = http.request({
    host: '127.0.0.1',
    port: Number(new URL(base).port),
    path: '/render',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  })
  const status = new Promise<number>((resolve) => {
    req.on('response', (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    // A destroyed request rejects with ECONNRESET; that is the expected outcome here, not a
    // failure, so it resolves to 0 rather than becoming an unhandled rejection.
    req.on('error', () => resolve(0))
  })
  req.end(body)
  return { status, destroy: () => req.destroy() }
}

/**
 * A bare TCP connection to the server, for the handful of cases `fetch` cannot express:
 * a request target too malformed to put in a URL, a body sent in two halves, and a second
 * request pipelined onto a connection whose first one is still running.
 */
function rawSocket(): { socket: net.Socket; response: Promise<string>; connected: Promise<void> } {
  const socket = net.connect(Number(new URL(base).port), '127.0.0.1')
  sockets.push(socket)
  const connected = new Promise<void>((resolve) => socket.once('connect', () => resolve()))
  const response = new Promise<string>((resolve) => {
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
    })
    // A reset is an answer too — the 413 path deliberately tears the socket down.
    socket.on('close', () => resolve(buffer))
    socket.on('error', () => resolve(buffer))
  })
  return { socket, response, connected }
}

/** Polls until `check` stops throwing, so tests never depend on a fixed number of ticks. */
async function waitFor(check: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      check()
      return
    } catch (err) {
      if (Date.now() > deadline) throw err
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

/** Polls /healthz until it reports the queue depths the test is waiting for. */
async function waitForHealth(match: Record<string, number>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const health = await (await fetch(`${base}/healthz`)).json()
    try {
      expect(health).toMatchObject(match)
      return
    } catch (err) {
      if (Date.now() > deadline) throw err
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

/** The handle for the server the current test started. */
function server(): ServeHandle {
  return servers[servers.length - 1]
}

/** Lets pending microtasks and one timer tick drain, to prove something has *not* happened. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

beforeEach(() => {
  logs = []
  vi.mocked(runJob).mockReset()
  vi.mocked(runJob).mockImplementation(async (spec) => outcomeFor(spec.jobId))
})

afterEach(async () => {
  while (sockets.length > 0) sockets.pop()?.destroy()
  while (servers.length > 0) {
    const server = servers.pop()
    if (server) await server.close()
  }
  vi.restoreAllMocks()
})

describe('GET /healthz', () => {
  it('reports ok, the kit versions and the queue depth', async () => {
    await start({ concurrency: 3 })

    const res = await fetch(`${base}/healthz`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({
      ok: true,
      versions: VERSIONS,
      inFlight: 0,
      queued: 0,
      maxQueue: 64,
      allowedSinks: ALLOWED_SINKS,
    })
  })

  it('counts the jobs that are running and waiting', async () => {
    const gate = deferred<RenderOutcome>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      return gate.promise
    })
    await start({ concurrency: 1 })

    const first = postSpec(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))
    const second = postSpec(validSpec('job-b'))
    await waitForHealth({ inFlight: 1, queued: 1 })

    gate.resolve(outcomeFor('job-a'))
    await Promise.all([first, second])
  })

  it('reports the configured queue bound', async () => {
    await start({ maxQueue: 5 })

    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ maxQueue: 5 })
  })

  it('rejects a non-GET with 405', async () => {
    await start()

    const res = await fetch(`${base}/healthz`, { method: 'POST' })

    expect(res.status).toBe(405)
    // HEAD is served too, so an Allow that named only GET would be a lie.
    expect(res.headers.get('allow')).toBe('GET, HEAD')
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('method') })
  })

  it('reports the sinks this server will accept', async () => {
    await start({ allowedSinks: ['volume', 'command'] })

    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({
      allowedSinks: ['volume', 'command'],
    })
  })
})

describe('the sink allow-list', () => {
  it('refuses a sink this server does not enable, before the job is queued', async () => {
    await start({ allowedSinks: ['volume', 'webhook', 's3'] })

    const res = await postSpec(
      validSpec('job-1', { output: { sink: 'command', config: { command: '/usr/bin/true' } } }),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'sink "command" is not enabled on this server (HEADLESS_SINKS)',
    })
    expect(runJob).not.toHaveBeenCalled()
    // Nothing was enqueued, so the refusal left no residue in the counters.
    await waitForHealth({ inFlight: 0, queued: 0 })
  })

  it('accepts the same sink once it is enabled', async () => {
    await start({ allowedSinks: ['volume', 'command'] })

    const res = await postSpec(
      validSpec('job-1', { output: { sink: 'command', config: { command: '/usr/bin/true' } } }),
    )

    expect(res.status).toBe(200)
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it('still refuses an invalid spec before it looks at the sink', async () => {
    await start({ allowedSinks: ['volume'] })

    const res = await postSpec(validSpec('job-1', { options: { format: 'gif' } }))

    expect(res.status).toBe(400)
  })
})

describe('run deps', () => {
  it('takes signal handling away from Playwright so the drain owns shutdown', async () => {
    await start()

    expect((await postSpec(validSpec('job-1'))).status).toBe(200)
    expect(vi.mocked(runJob).mock.calls[0][1].handleSignals).toBe(false)
  })
})

describe('POST /render', () => {
  it('returns 200 and the render outcome', async () => {
    await start()

    const res = await postSpec(validSpec('job-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(outcomeFor('job-1'))
    expect(vi.mocked(runJob).mock.calls[0][0].jobId).toBe('job-1')
    expect(vi.mocked(runJob).mock.calls[0][1]).toMatchObject(DEPS)
  })

  it('still returns 200 when the job itself failed — the request succeeded, the job did not', async () => {
    vi.mocked(runJob).mockResolvedValue({ jobId: 'job-1', ok: false, error: 'encoder died', durationMs: 3 })
    await start()

    const res = await postSpec(validSpec('job-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, error: 'encoder died' })
  })

  it('reports unknown job-spec fields as warnings alongside the outcome', async () => {
    await start()

    const res = await postSpec(validSpec('job-1', { qualitiy: 'high', options: { format: 'mp4', resoluton: '720p' } }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, warnings: ['qualitiy', 'options.resoluton'] })
  })

  it('omits warnings when the spec uses only known fields', async () => {
    await start()

    const body = (await (await postSpec(validSpec('job-1'))).json()) as Record<string, unknown>

    expect(body).not.toHaveProperty('warnings')
  })

  it('returns 400 for a body that is not JSON', async () => {
    await start()

    const res = await post('{ not json')

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('JSON') })
    expect(runJob).not.toHaveBeenCalled()
  })

  it('returns 400 with the validation message for an invalid spec', async () => {
    await start()

    const res = await postSpec(validSpec('job-1', { options: { format: 'gif' } }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'options.format must be one of "mp4" or "webm"' })
    expect(runJob).not.toHaveBeenCalled()
  })

  it('returns 413 for a body over 1 MiB', async () => {
    await start()

    const res = await postSpec(validSpec('job-1', { pad: 'x'.repeat(1024 * 1024) }))

    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('1048576') })
    expect(runJob).not.toHaveBeenCalled()
  })

  it('hangs up on a body far past the limit instead of draining it forever', async () => {
    await start()

    // Past MAX_BODY_BYTES * DRAIN_FACTOR: the server stops reading and tears the socket down,
    // so the client sees a reset rather than an answer — which is the point. Draining a
    // deliberate multi-gigabyte upload just to be polite is the failure mode being avoided.
    await expect(postSpec(validSpec('job-1', { pad: 'x'.repeat(9 * 1024 * 1024) }))).rejects.toThrow()

    expect(logs.some((line) => line.startsWith('POST /render 413'))).toBe(true)
    expect(runJob).not.toHaveBeenCalled()
  })

  it('accepts a content-type with a charset parameter', async () => {
    await start()

    const res = await post(JSON.stringify(validSpec('job-1')), {
      'content-type': 'application/json; charset=utf-8',
    })

    expect(res.status).toBe(200)
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it('returns 415 when the body is not declared as JSON', async () => {
    await start()

    const res = await post(JSON.stringify(validSpec()), { 'content-type': 'text/plain' })

    expect(res.status).toBe(415)
    expect(runJob).not.toHaveBeenCalled()
  })

  it('rejects a GET with 405', async () => {
    await start()

    const res = await fetch(`${base}/render`)

    expect(res.status).toBe(405)
    expect(runJob).not.toHaveBeenCalled()
  })
})

describe('binding', () => {
  it('rejects rather than resolving when the port is already taken', async () => {
    const first = await start()

    await expect(
      startServer({
        port: first.port,
        host: '127.0.0.1',
        deps: DEPS,
        allowedSinks: ALLOWED_SINKS,
        versions: VERSIONS,
        log: (line) => logs.push(line),
      }),
    ).rejects.toThrow(/EADDRINUSE/)
  })

  it('binds loopback by default, because there is no authentication in front of it', async () => {
    const handle = await startServer({
      port: 0,
      deps: DEPS,
      allowedSinks: ALLOWED_SINKS,
      versions: VERSIONS,
      log: (line) => logs.push(line),
    })
    servers.push(handle)

    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`)
    expect(res.status).toBe(200)
  })

  it('survives a log sink that throws, rather than turning it into an unhandled rejection', async () => {
    const seen: string[] = []
    await start({
      log: (line) => {
        seen.push(line)
        throw new Error('the log sink broke')
      },
    })

    expect((await fetch(`${base}/healthz`)).status).toBe(200)
    expect(seen.some((line) => line.startsWith('GET /healthz 200'))).toBe(true)
    // Still serving after the log threw.
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
  })

  it('logs to stderr when no log sink is given, leaving stdout to the one-shot CLI', async () => {
    const written: string[] = []
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })

    try {
      await start({ log: undefined })
      expect((await fetch(`${base}/healthz`)).status).toBe(200)
    } finally {
      stderr.mockRestore()
    }

    expect(written.some((line) => line.startsWith('GET /healthz 200'))).toBe(true)
  })
})

describe('unknown routes', () => {
  it('returns 404 as JSON', async () => {
    await start()

    const res = await fetch(`${base}/nope`)

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('not found') })
  })
})

describe('a request target that is not a URL', () => {
  it('answers 404 rather than taking the server down with it', async () => {
    await start()

    // "//[" is a legal HTTP request target that `new URL()` refuses (an unterminated IPv6
    // host). Throwing out of the request listener would be an uncaught exception — the whole
    // server, and every in-flight render with it.
    const { socket, response, connected } = rawSocket()
    await connected
    socket.write('GET //[ HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n')

    expect(await response).toContain('HTTP/1.1 404 Not Found')
    // Still serving.
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
    expect(logs.some((line) => line.startsWith('GET //[ 404'))).toBe(true)
  })
})

describe('request logging', () => {
  it('logs method, path, status and elapsed ms', async () => {
    await start()

    await fetch(`${base}/healthz`)

    await waitFor(() => expect(logs.some((line) => /^GET \/healthz 200 \d+ms$/.test(line))).toBe(true))
  })
})

describe('concurrency', () => {
  it('runs one job at a time with concurrency 1', async () => {
    const gates = new Map<string, Deferred<RenderOutcome>>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      const gate = deferred<RenderOutcome>()
      gates.set(spec.jobId, gate)
      return gate.promise
    })
    await start({ concurrency: 1 })

    const first = postSpec(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))

    const second = postSpec(validSpec('job-b'))
    // Wait for job-b to be *known* to the server before asserting it has not started, so the
    // assertion can never pass merely because the request had not arrived yet.
    await waitForHealth({ inFlight: 1, queued: 1 })
    expect(started).toEqual(['job-a'])

    gates.get('job-a')?.resolve(outcomeFor('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a', 'job-b']))
    gates.get('job-b')?.resolve(outcomeFor('job-b'))

    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
  })

  it('runs two jobs at once with concurrency 2', async () => {
    const gates = new Map<string, Deferred<RenderOutcome>>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      const gate = deferred<RenderOutcome>()
      gates.set(spec.jobId, gate)
      return gate.promise
    })
    await start({ concurrency: 2 })

    const first = postSpec(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))
    const second = postSpec(validSpec('job-b'))
    await waitFor(() => expect(started).toEqual(['job-a', 'job-b']))

    gates.get('job-a')?.resolve(outcomeFor('job-a'))
    gates.get('job-b')?.resolve(outcomeFor('job-b'))
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
  })
})

describe('the queue bound', () => {
  it('turns a job away with 429 once the queue is full, and recovers afterwards', async () => {
    const gates = new Map<string, Deferred<RenderOutcome>>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      const gate = deferred<RenderOutcome>()
      gates.set(spec.jobId, gate)
      return gate.promise
    })
    await start({ concurrency: 1, maxQueue: 1 })

    const first = postSpec(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))
    const second = postSpec(validSpec('job-b'))
    await waitForHealth({ inFlight: 1, queued: 1, maxQueue: 1 })

    // One running, one queued, no room for a third.
    const third = await postSpec(validSpec('job-c'))
    expect(third.status).toBe(429)
    expect(third.headers.get('retry-after')).toBe('5')
    expect(await third.json()).toEqual({ error: 'render queue is full (1 queued)' })
    expect(started).toEqual(['job-a'])

    gates.get('job-a')?.resolve(outcomeFor('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a', 'job-b']))
    gates.get('job-b')?.resolve(outcomeFor('job-b'))
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)

    // The refused job left no residue in the counters.
    await waitForHealth({ inFlight: 0, queued: 0 })
    expect(runJob).toHaveBeenCalledTimes(2)
  })

  it('never refuses a job it could have run', async () => {
    const gate = deferred<RenderOutcome>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      return gate.promise
    })
    await start({ concurrency: 2, maxQueue: 1 })

    // Two slots plus one queue place: three jobs fit.
    const posts = [postSpec(validSpec('job-a')), postSpec(validSpec('job-b')), postSpec(validSpec('job-c'))]
    await waitForHealth({ inFlight: 2, queued: 1 })

    gate.resolve(outcomeFor('shared'))
    for (const res of await Promise.all(posts)) expect(res.status).toBe(200)
  })
})

describe('close()', () => {
  it('waits for the in-flight job and turns a queued one away with 503', async () => {
    const gates = new Map<string, Deferred<RenderOutcome>>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      const gate = deferred<RenderOutcome>()
      gates.set(spec.jobId, gate)
      return gate.promise
    })
    const server = await start({ concurrency: 1 })

    const first = postSpec(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))
    const second = postSpec(validSpec('job-b'))
    await settle()

    let closed = false
    const closing = server.close().then(() => {
      closed = true
    })

    const queued = await second
    expect(queued.status).toBe(503)
    expect(await queued.json()).toEqual({ error: 'server shutting down' })

    await settle()
    expect(closed).toBe(false)
    expect(started).toEqual(['job-a'])

    gates.get('job-a')?.resolve(outcomeFor('job-a'))
    expect((await first).status).toBe(200)
    await closing
    expect(closed).toBe(true)
  })

  it('stops answering /healthz once the drain has begun', async () => {
    const gate = deferred<RenderOutcome>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      return gate.promise
    })
    const server = await start({ concurrency: 1 })

    const first = postSpec(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))
    const closing = server.close()

    // A draining server has stopped accepting connections, so a readiness probe cannot even
    // connect — which is the signal. It never answers "ok" while it is on the way out.
    await expect(fetch(`${base}/healthz`)).rejects.toThrow()

    gate.resolve(outcomeFor('job-a'))
    expect((await first).status).toBe(200)
    await closing
  })

  it('turns away a job whose body was still arriving when the drain began', async () => {
    await start({ concurrency: 1 })
    const body = JSON.stringify(validSpec('job-late'))

    const { socket, response, connected } = rawSocket()
    await connected
    // Headers plus the first byte: the server has dispatched the request and is inside
    // readBody, so this connection counts as active and survives closeIdleConnections.
    socket.write(
      `POST /render HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\n` +
        `content-length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 1)}`,
    )
    await settle()

    const closing = server().close()
    // Only now does the spec finish arriving — the job reaches the limiter after shutdown.
    socket.write(body.slice(1))

    const answer = await response
    // Answered at all, rather than reset: the request was live before the drain started, so
    // this 503 is the limiter refusing to *start* it, not the router refusing to accept it.
    expect(answer).toContain('HTTP/1.1 503 Service Unavailable')
    expect(answer).toContain('"error":"server shutting down"')
    expect(runJob).not.toHaveBeenCalled()
    await closing
  })

  it('turns away a request pipelined onto a live connection during the drain', async () => {
    const gate = deferred<RenderOutcome>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      return gate.promise
    })
    await start({ concurrency: 1 })
    const body = JSON.stringify(validSpec('job-a'))

    const { socket, response, connected } = rawSocket()
    await connected
    socket.write(
      `POST /render HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\n` +
        `content-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    )
    await waitFor(() => expect(started).toEqual(['job-a']))

    const closing = server().close()
    // server.close() stops new *connections*; this one is already open and its render is still
    // running, so a client can pipeline another request straight into a draining server.
    socket.write('GET /healthz HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n')
    await waitFor(() => expect(logs.some((line) => line.startsWith('GET /healthz 503'))).toBe(true))

    // The in-flight render was never touched by it.
    gate.resolve(outcomeFor('job-a'))
    await closing
    await response
    expect(started).toEqual(['job-a'])
  })

  it('is safe to call twice', async () => {
    const server = await start()

    await Promise.all([server.close(), server.close()])
    await server.close()
  })
})

describe('handler failures', () => {
  it('answers 500 and keeps serving when a handler throws', async () => {
    vi.mocked(runJob).mockImplementation(() => {
      throw new Error('boom')
    })
    await start()

    const res = await postSpec(validSpec('job-1'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'boom' })

    // The process is still up and the server still answers.
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
  })
})

describe('a client that hangs up', () => {
  it('drops its job from the queue and never starts it', async () => {
    const gates = new Map<string, Deferred<RenderOutcome>>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      const gate = deferred<RenderOutcome>()
      gates.set(spec.jobId, gate)
      return gate.promise
    })
    await start({ concurrency: 1 })

    const first = postSpec(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))
    const second = postRaw(validSpec('job-b'))
    await waitForHealth({ inFlight: 1, queued: 1 })

    second.destroy()
    expect(await second.status).toBe(0)
    await waitForHealth({ inFlight: 1, queued: 0 })
    await waitFor(() => expect(logs).toContain('POST /render aborted by client'))

    gates.get('job-a')?.resolve(outcomeFor('job-a'))
    expect((await first).status).toBe(200)
    await settle()

    // The slot job-a freed went to nobody: job-b was gone before it could claim it.
    expect(started).toEqual(['job-a'])
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it('lets a job that already started finish, because half a render is worse than a wasted one', async () => {
    const gates = new Map<string, Deferred<RenderOutcome>>()
    const started: string[] = []
    vi.mocked(runJob).mockImplementation(async (spec) => {
      started.push(spec.jobId)
      const gate = deferred<RenderOutcome>()
      gates.set(spec.jobId, gate)
      return gate.promise
    })
    await start({ concurrency: 1 })

    const only = postRaw(validSpec('job-a'))
    await waitFor(() => expect(started).toEqual(['job-a']))

    only.destroy()
    expect(await only.status).toBe(0)
    await settle()

    gates.get('job-a')?.resolve(outcomeFor('job-a'))
    await waitForHealth({ inFlight: 0, queued: 0 })
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(logs).not.toContain('POST /render aborted by client')
  })
})
