// apps/artist/src/headless/types.test.ts
import { describe, it, expect } from 'vitest'
import type { RenderInput, RenderMeta } from './types'

describe('headless render contract', () => {
  it('RenderInput composes a Project, sources, and options', () => {
    // Compile-time contract check executed as a trivial runtime assertion.
    const input: RenderInput = {
      project: { id: 'p', name: 'n', resolution: { width: 2, height: 2 },
        timeline: { tracks: [], clips: [], textOverlays: [], shapeOverlays: [], duration: 0 } } as unknown as RenderInput['project'],
      sourceVideos: [],
      sourceBlobs: {},
      options: { format: 'mp4' } as RenderInput['options'],
    }
    expect(input.options.format).toBe('mp4')
    const meta: RenderMeta = { format: 'mp4', byteLength: 0, durationSec: 0, width: 2, height: 2, gpu: false }
    expect(meta.format).toBe('mp4')
  })
})
