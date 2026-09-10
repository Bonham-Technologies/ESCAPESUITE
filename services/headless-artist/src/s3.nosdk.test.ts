import { describe, it, expect, vi } from 'vitest'
import { getSink } from './sinks'

/**
 * `@aws-sdk/client-s3` is an *optional* dependency: it is installed in this repo, so the
 * "it isn't there" path can only be reached by making the load fail on purpose. This file
 * does exactly that and nothing else — the same failure a deployment that skipped optional
 * dependencies (`npm install --omit=optional`, most Docker images) produces at run time.
 */
vi.mock('@aws-sdk/client-s3', () => {
  throw Object.assign(new Error("Cannot find package '@aws-sdk/client-s3'"), {
    code: 'ERR_MODULE_NOT_FOUND',
  })
})

describe('the s3 sink without its optional dependency', () => {
  it('names the package to install rather than reporting a module-resolution failure', async () => {
    await expect(getSink('s3', { prefix: 'bucket/renders' })).rejects.toThrow(
      's3 sink requires the optional dependency @aws-sdk/client-s3',
    )
  })

  it('keeps the underlying load failure as the cause, for a diagnosable stack', async () => {
    const { s3Sink } = await import('./s3')

    const err = await s3Sink({ prefix: 'bucket/renders' }).catch((e: unknown) => e)

    expect((err as Error).message).toBe('s3 sink requires the optional dependency @aws-sdk/client-s3')
    // Whatever the loader actually complained about is still attached, so the stack says
    // *why* it could not be loaded and not merely that it wasn't.
    expect((err as Error).cause).toBeInstanceOf(Error)
  })

  it('never reaches the loader when an injected client makes the SDK unnecessary', async () => {
    const { s3Sink } = await import('./s3')

    const sink = await s3Sink({ prefix: 'bucket/renders' }, { send: async () => ({}) })

    expect(typeof sink.deliver).toBe('function')
  })
})
