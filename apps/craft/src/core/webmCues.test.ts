import { describe, it, expect } from 'vitest'
import { writeKeyframeCues } from './webmCues'
import {
  buildWebM,
  readCues,
  expectIndexesKeyframes,
  PIP_SPEC,
  PIP_KEYFRAMES,
  SIMPLE_SPEC,
  SIMPLE_KEYFRAMES,
  AUDIO_SPEC,
  bytesOf,
} from '../test/webmFixture'

/**
 * The keyframe Cues index a stored MediaRecorder WebM is given (ESCSUITE-322).
 *
 * `webm-duration-fix` records a CuePoint only for a video SimpleBlock, and
 * Chrome writes every frame of the compositor's alpha-VP9 canvas stream as a
 * BlockGroup, so a composited-PiP take was stored with an empty Cues element —
 * which Firefox cannot seek (ESCSUITE-305). These pin the step that rewrites
 * that element with one CuePoint per video keyframe.
 */

describe('writeKeyframeCues', () => {
  it('indexes the keyframes of a take whose video frames are all BlockGroups', async () => {
    const fixture = buildWebM(PIP_SPEC)
    const out = await bytesOf(await writeKeyframeCues(fixture.blob))
    expectIndexesKeyframes(fixture, out, PIP_KEYFRAMES)
  })

  it('indexes the keyframes of a SimpleBlock take, replacing the per-cluster cues it carried', async () => {
    const fixture = buildWebM(SIMPLE_SPEC)
    expect(readCues(fixture.bytes).points.map((p) => p.time)).toEqual([0, 1000])

    const out = await bytesOf(await writeKeyframeCues(fixture.blob))

    expectIndexesKeyframes(fixture, out, SIMPLE_KEYFRAMES)
  })

  it('keeps the type of the blob it was handed', async () => {
    const out = await writeKeyframeCues(buildWebM(PIP_SPEC).blob)
    expect(out.type).toBe('video/webm')
  })

  it('reads the file in windows: a window smaller than one element gives the same bytes', async () => {
    const fixture = buildWebM(PIP_SPEC)
    const whole = await bytesOf(await writeKeyframeCues(fixture.blob))
    const windowed = await bytesOf(await writeKeyframeCues(fixture.blob, 4))
    expect(windowed).toEqual(whole)
  })

  it('hands an audio-only take back untouched: no video, no video cues, not refused', async () => {
    const fixture = buildWebM(AUDIO_SPEC)
    const out = await writeKeyframeCues(fixture.blob)
    expect(out).toBe(fixture.blob)
  })

  it('refuses a video take with no Cues element to fill rather than writing a broken file', async () => {
    const fixture = buildWebM({ ...PIP_SPEC, cues: 'none' })
    await expect(writeKeyframeCues(fixture.blob)).rejects.toThrow(/no Cues element/)
  })

  it('writes one CuePoint per keyframe and nothing else', async () => {
    // The mutation this file exists for: skip the step and the BlockGroup take
    // keeps its empty Cues element.
    const fixture = buildWebM(PIP_SPEC)
    expect(readCues(fixture.bytes).cuesPayloadBytes).toBe(0)
    const out = await bytesOf(await writeKeyframeCues(fixture.blob))
    expect(readCues(out).points).toHaveLength(PIP_KEYFRAMES.length)
  })
})
