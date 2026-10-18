import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { extractVideoMetadata } from './videoProcessor'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { mediaFile } from '../test/doubles/files'
import { restoreEngine, setEngine } from '../test/engine'

// ESCSUITE-327: an engine the probe was not measured on stores 30 'assumed'
// through the arm videoProcessor already has; Chromium still measures.
const spaced = (interval: number, count: number) => Array.from({ length: count }, (_, i) => i * interval)

describe('extractVideoMetadata frame-rate engine gate (ESCSUITE-327)', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles()
    media.script({ video: { videoWidth: 1280, videoHeight: 720, frameTimes: spaced(1 / 60, 8) } })
  })

  afterEach(() => {
    media.uninstall()
    restoreEngine()
  })

  it('stores 30 assumed on Firefox, without playing the element', async () => {
    setEngine('firefox')

    const metadata = await extractVideoMetadata(mediaFile(['v'], 'sixty.mp4', 'video/mp4'))

    expect(metadata.frameRate).toBe(30)
    expect(metadata.frameRateSource).toBe('assumed')
    expect(media.videos[0].play).not.toHaveBeenCalled()
  })

  it('measures on Chromium', async () => {
    setEngine('chromium')

    const metadata = await extractVideoMetadata(mediaFile(['v'], 'sixty.mp4', 'video/mp4'))

    expect(metadata.frameRate).toBe(60)
    expect(metadata.frameRateSource).toBe('measured')
  })

  // ESCSUITE-119: restoring the engine must not take the setup file's stubs with it.
  it('leaves the URL stubs from src/test/setup.ts as mock functions', () => {
    expect(vi.isMockFunction(URL.createObjectURL)).toBe(true)
    expect(vi.isMockFunction(URL.revokeObjectURL)).toBe(true)
  })
})
