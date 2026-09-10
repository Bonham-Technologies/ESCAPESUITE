import { describe, it, expect } from 'vitest'
import { collectUnknownKeys, parseJobSpec } from './jobSpec'

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
})
