import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectUnknownKeys, ensureSinkReady, parseJobSpec } from './jobSpec'
import * as s3Module from './s3'

function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: 'job-123',
    input: { manifest: { path: '/tmp/manifest.json' } },
    options: { format: 'mp4' },
    output: { sink: 'volume', config: { dir: '/tmp/out' } },
    ...overrides,
  }
}

describe('parseJobSpec', () => {
  it('parses a minimal valid spec and applies the quality default', () => {
    const spec = parseJobSpec(validSpec())
    expect(spec).toEqual({
      jobId: 'job-123',
      input: { manifest: { path: '/tmp/manifest.json' } },
      options: { format: 'mp4', quality: 'high' },
      output: { sink: 'volume', config: { dir: '/tmp/out' } },
    })
  })

  it('keeps an explicit quality', () => {
    const spec = parseJobSpec(validSpec({ options: { format: 'webm', quality: 'low' } }))
    expect(spec.options.quality).toBe('low')
  })

  it('keeps an explicit resolution', () => {
    const spec = parseJobSpec(validSpec({ options: { format: 'mp4', resolution: '720p' } }))
    expect(spec.options.resolution).toBe('720p')
  })

  it('keeps a valid timeRange', () => {
    const spec = parseJobSpec(validSpec({ options: { format: 'mp4', timeRange: { start: 0, end: 5 } } }))
    expect(spec.options.timeRange).toEqual({ start: 0, end: 5 })
  })

  it('accepts a bundle input', () => {
    const spec = parseJobSpec(validSpec({ input: { bundle: { path: '/tmp/project.veditor' } } }))
    expect(spec.input).toEqual({ bundle: { path: '/tmp/project.veditor' } })
  })

  it('rejects a non-object job spec', () => {
    expect(() => parseJobSpec(null)).toThrow(/object/)
    expect(() => parseJobSpec('nope')).toThrow(/object/)
  })

  it('rejects a missing jobId', () => {
    const spec = validSpec()
    delete spec.jobId
    expect(() => parseJobSpec(spec)).toThrow(/jobId/)
  })

  it('rejects an empty jobId', () => {
    expect(() => parseJobSpec(validSpec({ jobId: '' }))).toThrow(/jobId/)
  })

  it('rejects a jobId with characters unsafe for a file name', () => {
    expect(() => parseJobSpec(validSpec({ jobId: '../etc/passwd' }))).toThrow(/jobId/)
    expect(() => parseJobSpec(validSpec({ jobId: 'job/with/slash' }))).toThrow(/jobId/)
    expect(() => parseJobSpec(validSpec({ jobId: 'job with space' }))).toThrow(/jobId/)
  })

  it('rejects "." and ".." as a jobId, which the character rule alone allows', () => {
    expect(() => parseJobSpec(validSpec({ jobId: '.' }))).toThrow(
      'jobId must not be "." or ".."; it is used as a directory name',
    )
    expect(() => parseJobSpec(validSpec({ jobId: '..' }))).toThrow(
      'jobId must not be "." or ".."; it is used as a directory name',
    )
  })

  it('accepts a jobId that merely contains dots', () => {
    expect(parseJobSpec(validSpec({ jobId: 'v1.2.3' })).jobId).toBe('v1.2.3')
    expect(parseJobSpec(validSpec({ jobId: '...' })).jobId).toBe('...')
  })

  it('rejects a jobId over 128 characters', () => {
    expect(() => parseJobSpec(validSpec({ jobId: 'a'.repeat(129) }))).toThrow(/jobId/)
  })

  it('rejects an input that is not an object at all', () => {
    expect(() => parseJobSpec(validSpec({ input: '/tmp/manifest.json' }))).toThrow(
      'input must be an object with exactly one of "bundle" or "manifest"',
    )
    expect(() => parseJobSpec(validSpec({ input: undefined }))).toThrow(
      'input must be an object with exactly one of "bundle" or "manifest"',
    )
  })

  it('rejects an input with neither bundle nor manifest', () => {
    expect(() => parseJobSpec(validSpec({ input: {} }))).toThrow(/input/)
  })

  it('rejects an input with both bundle and manifest', () => {
    expect(() =>
      parseJobSpec(
        validSpec({
          input: { bundle: { path: '/tmp/a.veditor' }, manifest: { path: '/tmp/b.json' } },
        }),
      ),
    ).toThrow(/input/)
  })

  it('rejects a bundle without a string path', () => {
    expect(() => parseJobSpec(validSpec({ input: { bundle: {} } }))).toThrow(/input\.bundle\.path/)
    expect(() => parseJobSpec(validSpec({ input: { bundle: { path: 42 } } }))).toThrow(/input\.bundle\.path/)
  })

  it('rejects a manifest without a string path', () => {
    expect(() => parseJobSpec(validSpec({ input: { manifest: {} } }))).toThrow(/input\.manifest\.path/)
  })

  it('rejects a missing options object', () => {
    const spec = validSpec()
    delete spec.options
    expect(() => parseJobSpec(spec)).toThrow(/options/)
  })

  it('rejects an invalid options.format', () => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'avi' } }))).toThrow(/options\.format/)
  })

  it('rejects an invalid options.quality', () => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'mp4', quality: 'ultra' } }))).toThrow(
      /options\.quality/,
    )
  })

  it('rejects an invalid options.resolution', () => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'mp4', resolution: '4k' } }))).toThrow(
      /options\.resolution/,
    )
  })

  // ESCSUITE-111: 'original' letterboxed the bottom clip's own source size
  // rather than following the project's aspect, the one thing ESCSUITE-94 made
  // every other resolution option do — and no UI ever offered it, only a
  // hand-built job spec could reach it. Dropped rather than fixed.
  it('rejects "original" now that it has been dropped from options.resolution', () => {
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'mp4', resolution: 'original' } })),
    ).toThrow(/options\.resolution/)
  })

  it('rejects a timeRange where start is not less than end', () => {
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'mp4', timeRange: { start: 5, end: 5 } } })),
    ).toThrow(/options\.timeRange/)
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'mp4', timeRange: { start: 5, end: 1 } } })),
    ).toThrow(/options\.timeRange/)
  })

  it('rejects a timeRange with non-numeric bounds', () => {
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'mp4', timeRange: { start: '0', end: 5 } } })),
    ).toThrow(/options\.timeRange/)
  })

  // ESCSUITE-191: `typeof` alone lets NaN and Infinity through as "numbers" —
  // both reach the exporter and inflate the manifest's durationSec instead of
  // being refused up front, the way the artist headless render path's own
  // clamp (renderProject.ts) now refuses an intersection that cannot be made
  // to work rather than rendering a silently wrong duration.
  it('rejects a timeRange with a non-finite bound', () => {
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'mp4', timeRange: { start: NaN, end: 5 } } })),
    ).toThrow(/options\.timeRange/)
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'mp4', timeRange: { start: 0, end: Infinity } } })),
    ).toThrow(/options\.timeRange/)
  })

  it('rejects a negative timeRange.start', () => {
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'mp4', timeRange: { start: -5, end: 1 } } })),
    ).toThrow(/options\.timeRange\.start must be >= 0/)
  })

  it('rejects a missing output object', () => {
    const spec = validSpec()
    delete spec.output
    expect(() => parseJobSpec(spec)).toThrow(/output/)
  })

  it('rejects an invalid output.sink', () => {
    expect(() => parseJobSpec(validSpec({ output: { sink: 'ftp', config: {} } }))).toThrow(
      /output\.sink/,
    )
  })

  it('rejects a non-object output.config', () => {
    expect(() => parseJobSpec(validSpec({ output: { sink: 'volume', config: 'nope' } }))).toThrow(
      /output\.config/,
    )
  })

  // ESCSUITE-192 (hunt-j J-4): output.config was unvalidated at parse time, so a job with a
  // sink config that could never work (no config.dir, say) was accepted with a 200/exit-0 and
  // rendered for the full budget before failing at delivery. The sink's own config shape is
  // now checked while the spec is parsed, so this fails before Chromium ever launches.
  describe('sink config is validated at parse time', () => {
    it('rejects a volume job with no config.dir', () => {
      expect(() =>
        parseJobSpec(validSpec({ output: { sink: 'volume', config: {} } })),
      ).toThrow(/volume sink requires config\.dir \(string\)/)
    })

    it('rejects a command job with no config.command', () => {
      expect(() =>
        parseJobSpec(validSpec({ output: { sink: 'command', config: {} } })),
      ).toThrow(/command sink requires config\.command \(string\)/)
    })

    it('rejects a webhook job with no config.url', () => {
      expect(() =>
        parseJobSpec(validSpec({ output: { sink: 'webhook', config: {} } })),
      ).toThrow(/webhook sink requires config\.url \(string\)/)
    })

    it('rejects an s3 job whose prefix names no bucket', () => {
      expect(() =>
        parseJobSpec(validSpec({ output: { sink: 's3', config: { prefix: 's3://' } } })),
      ).toThrow(/s3 sink requires config\.prefix to name a bucket/)
    })

    it('rejects an s3 job with a non-string region', () => {
      expect(() =>
        parseJobSpec(
          validSpec({ output: { sink: 's3', config: { prefix: 'bucket', region: 42 } } }),
        ),
      ).toThrow(/s3 sink requires config\.region \(string\) when provided/)
    })

    it('accepts a valid config for every sink', () => {
      expect(() =>
        parseJobSpec(validSpec({ output: { sink: 'command', config: { command: '/bin/true' } } })),
      ).not.toThrow()
      expect(() =>
        parseJobSpec(validSpec({ output: { sink: 'webhook', config: { url: 'https://x/y' } } })),
      ).not.toThrow()
      expect(() =>
        parseJobSpec(validSpec({ output: { sink: 's3', config: { prefix: 'bucket/renders' } } })),
      ).not.toThrow()
    })

    it('keeps the raw config object in the parsed spec, unmodified', () => {
      // Validation is a side effect, not a normalisation step: the config a caller gets back
      // is exactly the one it sent, defaults (command's timeoutMs, say) included or not.
      const spec = parseJobSpec(validSpec({ output: { sink: 'command', config: { command: '/bin/true' } } }))
      expect(spec.output.config).toEqual({ command: '/bin/true' })
    })
  })

  it('accepts gif as a format', () => {
    const spec = parseJobSpec(validSpec({ options: { format: 'gif' } }))
    expect(spec.options).toEqual({ format: 'gif', quality: 'high' })
  })

  it('keeps a 360p resolution', () => {
    // '360p' is accepted for any format, not just gif: `getResolution` answers
    // it for all three and an MP4 at 640x360 is a legitimate thing to ask a
    // render farm for. The export *dialog* is where 360p is gif-only, because
    // that is a choice about what to offer rather than about what works.
    const spec = parseJobSpec(validSpec({ options: { format: 'gif', resolution: '360p' } }))
    expect(spec.options.resolution).toBe('360p')
  })

  it('keeps a 360p resolution for a video format too', () => {
    const spec = parseJobSpec(validSpec({ options: { format: 'mp4', resolution: '360p' } }))
    expect(spec.options.resolution).toBe('360p')
  })

  it.each([10, 15, 20])('keeps an fps of %s for a gif', (fps) => {
    const spec = parseJobSpec(validSpec({ options: { format: 'gif', fps } }))
    expect(spec.options.fps).toBe(fps)
  })

  it('leaves fps unset when a gif job does not ask for one', () => {
    // The exporter's own default (15) applies; the spec does not invent one.
    const spec = parseJobSpec(validSpec({ options: { format: 'gif' } }))
    expect(spec.options.fps).toBeUndefined()
  })

  it.each([7, 0, 30, '15', 15.5, null])('rejects an fps of %s', (fps) => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'gif', fps } }))).toThrow(
      /options\.fps must be one of 10, 15, or 20/,
    )
  })

  it.each(['mp4', 'webm'])('rejects fps for a %s job', (format) => {
    // Silently ignoring it would render at 30 fps while the caller believed
    // otherwise — the failure mode `collectUnknownKeys` exists to prevent, for a
    // field that is known but inapplicable.
    expect(() => parseJobSpec(validSpec({ options: { format, fps: 15 } }))).toThrow(
      /options\.fps applies to "gif" only/,
    )
  })

  it('names gif in the format error', () => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'avi' } }))).toThrow(
      /options\.format must be one of "mp4", "webm", or "gif"/,
    )
  })

  it('names 360p in the resolution error', () => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'gif', resolution: '240p' } }))).toThrow(
      /"720p", "480p", or "360p"/,
    )
  })

  it('refuses an empty range on a gif job here rather than leaving it to the exporter', () => {
    // A GIF of an empty range is the one range the exporter itself refuses
    // (zero frames would otherwise write a one-byte "image/gif"), and the kit
    // says so before Chromium launches — the same check every format gets.
    expect(() =>
      parseJobSpec(validSpec({ options: { format: 'gif', timeRange: { start: 3, end: 3 } } })),
    ).toThrow(/options\.timeRange\.start must be less than options\.timeRange\.end/)
  })
})

describe('collectUnknownKeys', () => {
  it('returns nothing for a spec using only known fields', () => {
    expect(collectUnknownKeys(validSpec())).toEqual([])
    expect(
      collectUnknownKeys(
        validSpec({ options: { format: 'mp4', quality: 'low', resolution: '720p', timeRange: { start: 0, end: 1 } } }),
      ),
    ).toEqual([])
  })

  it('names a misspelled top-level key', () => {
    expect(collectUnknownKeys(validSpec({ qualitiy: 'high' }))).toEqual(['qualitiy'])
  })

  it('names a misspelled options key with a dotted path', () => {
    expect(collectUnknownKeys(validSpec({ options: { format: 'mp4', resoluton: '720p' } }))).toEqual([
      'options.resoluton',
    ])
  })

  it('reports top-level and options keys together, top level first', () => {
    expect(
      collectUnknownKeys(validSpec({ extra: 1, options: { format: 'mp4', bitrate: 900 } })),
    ).toEqual(['extra', 'options.bitrate'])
  })

  it('returns nothing for input that is not an object at all', () => {
    expect(collectUnknownKeys(null)).toEqual([])
    expect(collectUnknownKeys('nope')).toEqual([])
    expect(collectUnknownKeys([1, 2])).toEqual([])
  })

  it('ignores a non-object options field rather than throwing', () => {
    expect(collectUnknownKeys(validSpec({ options: 'nope' }))).toEqual([])
  })

  it('does not flag fps, which the parser reads', () => {
    expect(collectUnknownKeys(validSpec({ options: { format: 'gif', fps: 15 } }))).toEqual([])
  })
})

// ESCSUITE-192 (hunt-j J-4): the s3 SDK's presence is the one sink-config check that cannot
// run synchronously inside parseJobSpec (it is a dynamic import), so it is a separate step a
// caller awaits right after parsing -- still before any render -- rather than folded into the
// parser itself.
describe('ensureSinkReady', () => {
  it('probes the s3 SDK and resolves when it is present', async () => {
    const probeSpy = vi.spyOn(s3Module, 'probeS3Sdk').mockResolvedValue(undefined)
    try {
      await expect(
        ensureSinkReady({ sink: 's3', config: { prefix: 'bucket' } }),
      ).resolves.toBeUndefined()
      expect(probeSpy).toHaveBeenCalledTimes(1)
    } finally {
      probeSpy.mockRestore()
    }
  })

  it('propagates the SDK-missing error', async () => {
    const probeSpy = vi
      .spyOn(s3Module, 'probeS3Sdk')
      .mockRejectedValue(new Error('s3 sink requires the optional dependency @aws-sdk/client-s3'))
    try {
      await expect(ensureSinkReady({ sink: 's3', config: { prefix: 'bucket' } })).rejects.toThrow(
        /requires the optional dependency @aws-sdk\/client-s3/,
      )
    } finally {
      probeSpy.mockRestore()
    }
  })

  it('does not probe the s3 SDK for any other sink', async () => {
    const probeSpy = vi.spyOn(s3Module, 'probeS3Sdk')
    try {
      await ensureSinkReady({ sink: 'volume', config: { dir: os.tmpdir() } })
      await ensureSinkReady({ sink: 'command', config: { command: '/bin/true' } })
      await ensureSinkReady({ sink: 'webhook', config: { url: 'https://x/y' } })
      expect(probeSpy).not.toHaveBeenCalled()
    } finally {
      probeSpy.mockRestore()
    }
  })
})

// ESCSUITE-236: a volume whose directory the process cannot write used to render in full and
// only then fail delivery with EACCES (which a broker reads as retryable). The probe creates
// and removes a private temp file, because fs.access lies about ACLs and read-only mounts.
describe('ensureSinkReady, volume sink', () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ready-'))
  })
  afterEach(async () => {
    await fs.chmod(root, 0o755)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('resolves for a writable directory and leaves nothing behind', async () => {
    await expect(ensureSinkReady({ sink: 'volume', config: { dir: root } })).resolves.toBeUndefined()
    expect(await fs.readdir(root)).toEqual([])
  })

  it('creates a missing directory, as the sink itself would', async () => {
    const dir = path.join(root, 'a', 'b')
    await ensureSinkReady({ sink: 'volume', config: { dir } })
    expect((await fs.stat(dir)).isDirectory()).toBe(true)
    expect(await fs.readdir(dir)).toEqual([])
  })

  it.skipIf(process.getuid?.() === 0)(
    'refuses an unwritable directory, naming it and the uid the process runs as',
    async () => {
      await fs.chmod(root, 0o555)
      const attempt = ensureSinkReady({ sink: 'volume', config: { dir: root } })
      await expect(attempt).rejects.toThrow(root)
      await expect(attempt).rejects.toThrow(`uid ${process.getuid?.()}`)
      await expect(attempt).rejects.toThrow(/EACCES/)
    },
  )

  it('refuses a directory that cannot be created', async () => {
    const file = path.join(root, 'file')
    await fs.writeFile(file, 'x')
    await expect(
      ensureSinkReady({ sink: 'volume', config: { dir: path.join(file, 'sub') } }),
    ).rejects.toThrow(/not writable by uid/)
  })
})
