import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { extractVideoMetadata } from './videoProcessor'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { mediaFile } from '../test/doubles/files'

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
    vi.unstubAllGlobals()
  })

  it('stores 30 assumed on Firefox, without playing the element', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0',
    })

    const metadata = await extractVideoMetadata(mediaFile(['v'], 'sixty.mp4', 'video/mp4'))

    expect(metadata.frameRate).toBe(30)
    expect(metadata.frameRateSource).toBe('assumed')
    expect(media.videos[0].play).not.toHaveBeenCalled()
  })

  it('measures on Chromium', async () => {
    vi.stubGlobal('navigator', { userAgent: 'x', userAgentData: { brands: [{ brand: 'Chromium' }] } })

    const metadata = await extractVideoMetadata(mediaFile(['v'], 'sixty.mp4', 'video/mp4'))

    expect(metadata.frameRate).toBe(60)
    expect(metadata.frameRateSource).toBe('measured')
  })
})
