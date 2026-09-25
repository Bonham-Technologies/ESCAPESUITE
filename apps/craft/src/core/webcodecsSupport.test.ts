// The two capability questions, asked directly.
//
// `isWebCodecsRecordingSupported` is covered through the recorder as well (it
// is re-exported from `webcodecs-recorder.ts`, which is where every caller
// imports it from); `canRecordSeparateTracks` is only ever asked here and by
// the UI, so this is the file that pins it.
import { describe, it, expect, afterEach } from 'vitest'
import { isWebCodecsRecordingSupported, canRecordSeparateTracks } from './webcodecsSupport'
import { installWebCodecsDoubles, uninstallWebCodecsDoubles } from '../test/doubles/webcodecs'
import {
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
} from '../test/doubles/mediastream'

describe('canRecordSeparateTracks', () => {
  afterEach(() => {
    uninstallTrackProcessorDouble()
    uninstallWebCodecsDoubles()
  })

  it('is true when WebCodecs and MediaStreamTrackProcessor are both there', () => {
    installWebCodecsDoubles()
    installTrackProcessorDouble()

    expect(isWebCodecsRecordingSupported()).toBe(true)
    expect(canRecordSeparateTracks()).toBe(true)
  })

  it('is false without MediaStreamTrackProcessor, even with WebCodecs', () => {
    // Chrome/Edge shipped the two together, so this combination is really
    // Firefox and Safari: the webcam pipeline reads frames from a track
    // processor and has no <video>+canvas fallback of its own, so the toggle
    // must be refused rather than silently recording one track.
    installWebCodecsDoubles()

    expect(isWebCodecsRecordingSupported()).toBe(true)
    expect('MediaStreamTrackProcessor' in globalThis).toBe(false)
    expect(canRecordSeparateTracks()).toBe(false)
  })

  it('is false without WebCodecs, even with MediaStreamTrackProcessor', () => {
    installTrackProcessorDouble()
    const g = globalThis as unknown as Record<string, unknown>
    const saved = g.VideoEncoder
    delete g.VideoEncoder
    try {
      expect(isWebCodecsRecordingSupported()).toBe(false)
      expect(canRecordSeparateTracks()).toBe(false)
    } finally {
      // Put the key back as it was, the way `recorder-factory.test.ts` does it.
      // Assigning `saved` when there was nothing there leaves an own property
      // present with the value `undefined`, which is a different global from the
      // one this test found — and `'X' in globalThis` is a question this module
      // asks of one of its two globals already.
      if (saved === undefined) delete g.VideoEncoder
      else g.VideoEncoder = saved
    }
    expect('VideoEncoder' in g).toBe(saved !== undefined)
  })
})
