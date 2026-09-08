import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startServer } from './serve'
import type { ServeOptions, ServeHandle } from './serve'
import { runJob } from './run'
import type { RunJobDeps } from './run'
import type { RenderOutcome } from './types'

// Chromium is out of scope here: these tests are about routing, limits and shutdown.
vi.mock('./run')

const VERSIONS = { kitVersion: 'kit-test', engineVersion: 'engine-test' }

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
let logs: string[]
let base: string

async function start(overrides: Partial<ServeOptions> = {}): Promise<ServeHandle> {
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    deps: DEPS,
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
    expect(await res.json()).toEqual({ ok: true, versions: VERSIONS, inFlight: 0, queued: 0, maxQueue: 64 })
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
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('method') })
  })
})

describe('POST /render', () => {
  it('returns 200 and the render outcome', async () => {
    await start()

    const res = await postSpec(validSpec('job-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(outcomeFor('job-1'))
    expect(vi.mocked(runJob).mock.calls[0][0].jobId).toBe('job-1')
    expect(vi.mocked(runJob).mock.calls[0][1]).toBe(DEPS)
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

describe('unknown routes', () => {
  it('returns 404 as JSON', async () => {
    await start()

    const res = await fetch(`${base}/nope`)

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('not found') })
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
