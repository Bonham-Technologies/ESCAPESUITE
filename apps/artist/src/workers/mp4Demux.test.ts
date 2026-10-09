// ESCSUITE-254: the decode worker has never decoded a frame. mp4box parses an
// in-memory file *inside* appendBuffer() and fires onReady from it, so
// extraction armed only after appendBuffer returned saw no samples at all:
// every source threw "No keyframes found in video" and every MP4 export fell
// back to in-page decoding. These cases run the worker's demux against real
// MP4 bytes, which is the only way to see that ordering.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { demuxVideoTrack } from './mp4Demux'

const MEDIA = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/media')

/** A fresh, detached-safe copy of a fixture's bytes (the demuxer writes `fileStart` onto it). */
function fixture(name: string): ArrayBuffer {
  const bytes = readFileSync(resolve(MEDIA, name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

describe('demuxVideoTrack', () => {
  it('extracts every sample of the video track, keyframe included', async () => {
    // h264-bframes.mp4 is apps/e2e/fixtures/headless/source.mp4: 25 frames of
    // 64x48 H.264 High with B-frames, one IDR.
    const { samples, keyframeSamples } = await demuxVideoTrack(fixture('h264-bframes.mp4'))

    expect(samples).toHaveLength(25)
    expect(keyframeSamples).toHaveLength(1)
  })
})
