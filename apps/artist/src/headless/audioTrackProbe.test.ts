// apps/artist/src/headless/audioTrackProbe.test.ts
//
// ESCSUITE-312: whether a source's container carries an audio track, read from its headers by
// mediabunny's demuxer — never decoded. Real bytes throughout (src/test/fixtures/media/README.md
// says how each file was made); the WAV is built here.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { anySourceCarriesAudio, containerHasAudioTrack } from './audioTrackProbe'
import type { SourceVideo } from '../store/types'

const MEDIA = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/media')
const media = (name: string): ArrayBuffer => {
  const bytes = readFileSync(resolve(MEDIA, name))
  // Copied into this realm's ArrayBuffer: Node's file buffers come from another realm, and
  // mediabunny's `BufferSource` checks `instanceof ArrayBuffer`.
  return new Uint8Array(bytes).buffer
}

/** A 0.1 s mono 16-bit PCM WAV of silence: a container with an audio track and nothing else. */
function wav(): ArrayBuffer {
  const frames = 4800
  const view = new DataView(new ArrayBuffer(44 + frames * 2))
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true)
  view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, frames * 2, true)
  return view.buffer
}

describe('containerHasAudioTrack', () => {
  it.each([
    ['an MP4 with H.264 and AAC', 'video-with-aac.mp4', true],
    ['an audio-only MP4', 'audio-only.mp4', true],
    ['a video-only MP4, moov first', 'h264-faststart.mp4', false],
    ['a video-only MP4, moov last', 'h264-bframes.mp4', false],
  ])('answers %s: %s', async (_what, name, expected) => {
    expect(await containerHasAudioTrack(media(name))).toBe(expected)
  })

  it('reads a Blob as well as an ArrayBuffer', async () => {
    expect(await containerHasAudioTrack(new Blob([media('video-with-aac.mp4')]))).toBe(true)
    expect(await containerHasAudioTrack(new Blob([media('h264-faststart.mp4')]))).toBe(false)
  })

  it('finds the audio track of a WAV', async () => {
    expect(await containerHasAudioTrack(wav())).toBe(true)
  })

  it('throws for bytes no demuxer recognises', async () => {
    await expect(containerHasAudioTrack(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow()
  })
})

describe('anySourceCarriesAudio', () => {
  const source = (id: string, mediaType: SourceVideo['mediaType'] = 'video'): SourceVideo =>
    ({ id, name: `${id}.mp4`, mediaType } as unknown as SourceVideo)
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warn.mockRestore() })

  it('is false when no source has an audio track', async () => {
    const probe = vi.fn(async () => false)
    expect(await anySourceCarriesAudio([source('a'), source('b')], { a: media('h264-faststart.mp4'), b: media('h264-bframes.mp4') }, probe)).toBe(false)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('stops at the first source that has one', async () => {
    const probe = vi.fn(async () => true)
    const blobs = { a: new ArrayBuffer(1), b: new ArrayBuffer(1) }
    expect(await anySourceCarriesAudio([source('a'), source('b')], blobs, probe)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(blobs.a)
  })

  it('counts an audio source as sounded without probing anything', async () => {
    const probe = vi.fn(async () => false)
    expect(await anySourceCarriesAudio([source('v'), source('a', 'audio')], { v: new ArrayBuffer(1), a: new ArrayBuffer(1) }, probe)).toBe(true)
    expect(probe).not.toHaveBeenCalled()
  })

  it('counts a source whose probe throws as sounded, warning once with its name', async () => {
    const probe = vi.fn(async () => { throw new Error('unsupported or unrecognizable format') })
    expect(await anySourceCarriesAudio([source('bad')], { bad: new ArrayBuffer(1) }, probe)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('"bad.mp4"')
  })

  it('is false for no sources at all', async () => {
    const probe = vi.fn(async () => true)
    expect(await anySourceCarriesAudio([], {}, probe)).toBe(false)
    expect(probe).not.toHaveBeenCalled()
  })
})
