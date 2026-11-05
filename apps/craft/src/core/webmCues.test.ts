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
  type FixtureSpec,
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

  it('indexes a video track whose number takes a two-byte vint', async () => {
    // Track 200: the TrackEntry says 200 and every block header carries it as
    // a two-byte vint, the longer form of the track number a block can hold.
    const wide = (track: number) => (track === 1 ? 200 : track)
    const fixture = buildWebM({
      ...PIP_SPEC,
      tracks: PIP_SPEC.tracks.map((t) => ({ ...t, number: wide(t.number) })),
      clusters: PIP_SPEC.clusters.map((c) => ({
        ...c,
        children: c.children.map((child) => ('track' in child ? { ...child, track: wide(child.track) } : child)),
      })),
    })
    const out = await bytesOf(await writeKeyframeCues(fixture.blob))
    expectIndexesKeyframes(fixture, out, PIP_KEYFRAMES, 200)
  })

  describe('refuses a layout it would index wrongly (the save then says NOT_SEEKABLE)', () => {
    // The step moves every Cluster by the Cues element's growth and leaves the
    // Segment size and the SeekHead alone. That is right for the library's
    // output and silently wrong for anything else, so anything else is refused.
    it('a Segment written with a known size', async () => {
      const fixture = buildWebM({ ...PIP_SPEC, segmentKnownSize: true })
      await expect(writeKeyframeCues(fixture.blob)).rejects.toThrow(/Segment has a known size/)
    })

    it('a Cluster ahead of the Cues element', async () => {
      const fixture = buildWebM({ ...PIP_SPEC, cuesAfterFirstCluster: true })
      await expect(writeKeyframeCues(fixture.blob)).rejects.toThrow(/Cluster ahead of its Cues/)
    })

    it('a SeekHead entry pointing past the Cues element', async () => {
      const fixture = buildWebM({ ...PIP_SPEC, seekEntryPastCues: true })
      await expect(writeKeyframeCues(fixture.blob)).rejects.toThrow(/SeekHead entry past its Cues/)
    })
  })

  it('refuses a video take in which no keyframe is found, rather than store an empty index', async () => {
    const fixture = buildWebM({
      tracks: PIP_SPEC.tracks,
      cues: 'empty',
      clusters: [
        {
          timecode: 0,
          unknownSize: true,
          children: [
            { kind: 'group', track: 1, rel: 0, alpha: true, reference: -33 },
            { kind: 'simple', track: 2, rel: 0, key: true },
            { kind: 'group', track: 1, rel: 33, alpha: true, reference: -33 },
          ],
        },
      ],
    })
    await expect(writeKeyframeCues(fixture.blob)).rejects.toThrow(/no video keyframe/)
  })

  describe('refuses an invalid EBML vint', () => {
    const withRaw = (bytes: number[]) =>
      buildWebM({
        ...PIP_SPEC,
        clusters: [
          {
            timecode: 0,
            unknownSize: false,
            children: [{ kind: 'group', track: 1, rel: 0 }, { kind: 'raw', bytes }],
          },
        ],
      })

    it('an element ID longer than four bytes', async () => {
      // 0x08 opens a five-byte vint, which no EBML ID may be.
      const fixture = withRaw([0x08, 0x00, 0x00, 0x00, 0x00, 0x81, 0x00])
      await expect(writeKeyframeCues(fixture.blob)).rejects.toThrow(/invalid EBML/)
    })

    it('an element size longer than eight bytes', async () => {
      // 0x00 opens no vint of eight bytes or fewer.
      const fixture = withRaw([0xec, 0x00, 0x00, 0x00])
      await expect(writeKeyframeCues(fixture.blob)).rejects.toThrow(/invalid EBML/)
    })
  })

  it('writes one CuePoint per keyframe and nothing else', async () => {
    // The mutation this file exists for: skip the step and the BlockGroup take
    // keeps its empty Cues element.
    const fixture = buildWebM(PIP_SPEC)
    expect(readCues(fixture.bytes).cuesPayloadBytes).toBe(0)
    const out = await bytesOf(await writeKeyframeCues(fixture.blob))
    expect(readCues(out).points).toHaveLength(PIP_KEYFRAMES.length)
  })

  // ESCSUITE-395: every fixture's Duration says 3000; a block past it means
  // the library's estimate fell short.
  describe('raises a Duration that falls short of the last block', () => {
    const pastDuration = (spec: FixtureSpec, track: number, timecode: number): FixtureSpec => ({
      ...spec,
      clusters: [
        ...spec.clusters,
        { timecode, unknownSize: true, children: [{ kind: 'simple', track, rel: 7, key: true }] },
      ],
    })

    it('on an audio-only take, changing nothing but the Duration', async () => {
      const fixture = buildWebM(pastDuration(AUDIO_SPEC, 1, 4000))

      const out = await bytesOf(await writeKeyframeCues(fixture.blob))

      expect(readCues(out).duration).toBe(4007)
      expect(out.length).toBe(fixture.bytes.length)
      const changed = [...out.keys()].filter((i) => out[i] !== fixture.bytes[i])
      expect(changed.length).toBeGreaterThan(0)
      expect(changed.length).toBeLessThanOrEqual(8)
    })

    it('on a video take, keeping every cue on its Cluster', async () => {
      const fixture = buildWebM(pastDuration(SIMPLE_SPEC, 1, 5000))

      const out = await bytesOf(await writeKeyframeCues(fixture.blob))

      const read = readCues(out)
      expect(read.duration).toBe(5007)
      expect(read.points.map((p) => p.time)).toEqual([...SIMPLE_KEYFRAMES.map(([, , t]) => t), 5007])
      for (const point of read.points) {
        const at = read.segmentDataStart + point.clusterPosition
        expect(out.slice(at, at + 4)).toEqual(new Uint8Array([0x1f, 0x43, 0xb6, 0x75]))
      }
    })

    it('counts a BlockGroup and every track, not only video SimpleBlocks', async () => {
      // Audio SimpleBlock past the Duration, then a video delta-frame BlockGroup past that.
      const spec = pastDuration(PIP_SPEC, 2, 5500)
      spec.clusters.push({ timecode: 6000, unknownSize: true, children: [{ kind: 'group', track: 1, rel: 0, reference: -33 }] })

      const out = await bytesOf(await writeKeyframeCues(buildWebM(spec).blob))

      expect(readCues(out).duration).toBe(6000)
    })

    it('reads the same through a window smaller than one element', async () => {
      const fixture = buildWebM(pastDuration(AUDIO_SPEC, 1, 4000))
      const whole = await bytesOf(await writeKeyframeCues(fixture.blob))
      expect(await bytesOf(await writeKeyframeCues(fixture.blob, 4))).toEqual(whole)
    })
  })
})
