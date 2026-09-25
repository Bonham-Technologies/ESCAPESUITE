// Bringing a handed-over take into the media library.
//
// Storage and the media probe are the App suite's recording doubles — this
// module is a collaborator of `useHostIntegration`, mocked the same way there,
// so the two suites see the same boundaries.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { importTake } from './takeImport'
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage'
import { resolveStoredDuration } from '../core/videoProcessor'
import { extractWaveformData } from '../utils/waveform'
import { sampleVideo } from '../test/appDoubles'
import {
  createAudioBufferDouble,
  installAudioContextDouble,
  type AudioContextDoubles,
} from '../test/doubles/audio'
import type { SourceVideo } from '../store/types'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
vi.mock('../core/videoProcessor', async () =>
  (await import('../test/appDoubles')).videoProcessorDouble()
)
// The real extractor, wrapped: the waveforms below are the ones the media
// library's own import path computes (`core/videoProcessor.ts` calls this same
// function), decoded through the AudioContext double. The wrapper is only so
// one test can make the call itself fail, which the extractor's own internal
// catch otherwise makes unreachable.
vi.mock('../utils/waveform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/waveform')>()
  return { ...actual, extractWaveformData: vi.fn(actual.extractWaveformData) }
})

const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

const primaryMetadata: SourceVideo = {
  ...sampleVideo,
  id: 'take-1',
  name: 'Screen recording',
  duration: 6,
  width: 1920,
  height: 1080,
  takeId: 'take-1',
  role: 'screen',
  startOffset: 0,
  overlayPlacement: PLACEMENT,
  hasWebcam: true,
  hasAudio: true,
}

const webcamMetadata: SourceVideo = {
  ...sampleVideo,
  id: 'take-1-webcam',
  name: 'Screen recording — webcam',
  duration: 6,
  width: 1280,
  height: 720,
  takeId: 'take-1',
  role: 'webcam',
  startOffset: 0.5,
  hasAudio: false,
}

/**
 * The microphone companion (ESCSUITE-14 slice 3): stored as audio, with no
 * dimensions, no thumbnail and no picture of any kind.
 */
const micMetadata: SourceVideo = {
  ...sampleVideo,
  id: 'take-1-mic',
  name: 'Screen recording — microphone',
  duration: 6,
  width: 0,
  height: 0,
  frameRate: 0,
  mediaType: 'audio',
  takeId: 'take-1',
  role: 'mic',
  startOffset: 0,
  hasAudio: true,
}

const primary = { blob: new Blob(['screen'], { type: 'video/webm' }), metadata: primaryMetadata }

/** Hand each companion its own blob, so a test can tell which was read. */
const storedBlobs: Record<string, Blob> = {
  'take-1-webcam': new Blob(['webcam'], { type: 'video/webm' }),
  'take-1-mic': new Blob(['mic'], { type: 'audio/webm' }),
}

let added: SourceVideo[]
const addSourceVideo = (video: SourceVideo) => {
  added.push(video)
}

/**
 * A tenth of a second of sample data at 48 kHz, which is ten peaks at
 * `extractWaveformData`'s 100-per-second — enough to be a waveform and small
 * enough to read. Alternating, because the extractor answers `hasAudio` from
 * the peaks it finds and silence is not audio to it.
 */
const PEAKS_PER_TENTH = 10
function samples(amplitude: number): Float32Array {
  const data = new Float32Array(4800)
  for (let i = 0; i < data.length; i += 1) data[i] = i % 2 === 0 ? amplitude : -amplitude
  return data
}

/** Web Audio is the browser's, so every test in this file decodes through the double. */
let audio: AudioContextDoubles

beforeEach(() => {
  added = []
  audio = installAudioContextDouble(createAudioBufferDouble([samples(0.5)], 48000))
  vi.mocked(getAllVideoMetadata).mockResolvedValue([primaryMetadata, webcamMetadata])
  vi.mocked(getVideo).mockResolvedValue({
    blob: new Blob(['webcam'], { type: 'video/webm' }),
    metadata: webcamMetadata,
  })
  vi.mocked(getThumbnail).mockResolvedValue(undefined)
  vi.mocked(resolveStoredDuration).mockImplementation((_blob, metadata) =>
    Promise.resolve(metadata.duration)
  )
})

afterEach(() => {
  audio.uninstall()
  vi.clearAllMocks()
})

describe('importTake', () => {
  it('asks storage for nothing extra when the take is a single file', async () => {
    const plain = { blob: primary.blob, metadata: { ...sampleVideo, id: 'plain' } }

    const take = await importTake(plain, addSourceVideo)

    // A recording made before ESCSUITE-14, and every composited PiP take after
    // it, carries no takeId — so there is nothing to resolve and no reason to
    // read the whole library.
    expect(getAllVideoMetadata).not.toHaveBeenCalled()
    expect(added.map((v) => v.id)).toEqual(['plain'])
    expect(take.clipParts).toHaveLength(1)
    expect(take.missingParts).toBe(0)
  })

  it('adds every part of a take and hands the placement to the webcam half', async () => {
    const take = await importTake(primary, addSourceVideo)

    expect(added.map((v) => v.id)).toEqual(['take-1', 'take-1-webcam'])
    expect(take.clipParts).toEqual([
      {
        sourceVideoId: 'take-1',
        name: 'Screen recording',
        duration: 6,
        startOffset: 0,
        width: 1920,
        height: 1080,
      },
      {
        sourceVideoId: 'take-1-webcam',
        name: 'Screen recording — webcam',
        duration: 6,
        startOffset: 0.5,
        width: 1280,
        height: 720,
        // Stored on the primary, carried onto the part it describes, so the
        // store needs to know nothing about roles.
        overlayPlacement: PLACEMENT,
      },
    ])
  })

  it('says which of a take parts have no picture', async () => {
    vi.mocked(getAllVideoMetadata).mockResolvedValue([primaryMetadata, webcamMetadata, micMetadata])
    vi.mocked(getVideo).mockImplementation((id: string) =>
      Promise.resolve({
        blob: storedBlobs[id],
        metadata: id === 'take-1-mic' ? micMetadata : webcamMetadata,
      })
    )

    const take = await importTake(primary, addSourceVideo)

    // The store gives an audio part the default transform and never measures
    // the webcam corner against it (ESCSUITE-71), and it can only do either if
    // the handoff says which parts those are. The `width: 0, height: 0` such a
    // part arrives with is a consequence and not a signal — a video part
    // stored 0x0 is a corrupt record, not a sound file. Absent rather than
    // `'video'` on the parts that have a picture, the way `role` and `takeId`
    // are absent on a single-file take.
    expect(take.clipParts.map((part) => part.mediaType)).toEqual([undefined, undefined, 'audio'])
  })

  it('refuses a take whose companion the library already holds, before it writes anything', async () => {
    // The primary is not in the library here: the user deleted it and the host
    // re-sent the take. The companion is, so the take is not new — and the
    // refusal has to land before the first `addSourceVideo`, because a part
    // re-added would replace its library entry (and its thumbnail URL) and a
    // part re-placed would arrive on the timeline twice.
    const take = await importTake(primary, addSourceVideo, (id) => id === 'take-1-webcam')

    expect(take.alreadyInLibrary).toBe(true)
    expect(take.clipParts).toEqual([])
    expect(take.thumbnailUrls).toEqual([])
    expect(added).toEqual([])
    expect(getVideo).not.toHaveBeenCalled()
    expect(getThumbnail).not.toHaveBeenCalled()
    expect(resolveStoredDuration).not.toHaveBeenCalled()
  })

  it('imports a take no part of which the library holds', async () => {
    const take = await importTake(primary, addSourceVideo, () => false)

    expect(take.alreadyInLibrary).toBe(false)
    expect(added.map((v) => v.id)).toEqual(['take-1', 'take-1-webcam'])
  })

  it('carries each part thumbnail as a blob URL for the caller to revoke', async () => {
    vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }))

    const take = await importTake(primary, addSourceVideo)

    expect(added.every((v) => v.thumbnailUrl === 'blob:mock-url')).toBe(true)
    // The URLs live as long as the library entries, so they cannot be revoked
    // where they are made — the effect's cleanup hands them back.
    expect(take.thumbnailUrls).toHaveLength(2)
  })

  it('skips a part whose blob is gone, and still brings in the rest', async () => {
    vi.mocked(getVideo).mockResolvedValue(undefined)

    const take = await importTake(primary, addSourceVideo)

    // Storage cleared between the two writes, or a companion deleted by hand:
    // the screen recording is still the take's point and must arrive.
    expect(added.map((v) => v.id)).toEqual(['take-1'])
    expect(take.clipParts.map((part) => part.sourceVideoId)).toEqual(['take-1'])
    expect(take.missingParts).toBe(1)
  })

  it('gives a part whose length cannot be read the take own length', async () => {
    vi.mocked(resolveStoredDuration).mockImplementation((_blob, metadata) =>
      metadata.id === 'take-1' ? Promise.resolve(6) : Promise.reject(new Error('no duration'))
    )

    const take = await importTake(primary, addSourceVideo)

    // Every part of a take is the same length by construction — one clock, one
    // start, one stop — so borrowing the primary's beats refusing to place it.
    expect(take.clipParts[1].duration).toBe(6)
    expect(added[1].duration).toBe(6)
  })

  it('gives a part whose own length is unusable the take own length too', async () => {
    // The other half of the same rule: a companion WebM that lost its Duration
    // element measures as Infinity rather than throwing, and an unusable number
    // is no more placeable than a missing one.
    vi.mocked(resolveStoredDuration).mockImplementation((_blob, metadata) =>
      Promise.resolve(metadata.id === 'take-1' ? 6 : Number.POSITIVE_INFINITY)
    )

    const take = await importTake(primary, addSourceVideo)

    expect(take.clipParts[1].duration).toBe(6)
    expect(added[1].duration).toBe(6)
  })

  it('lists a part with an unknown role without placing it', async () => {
    const future = { ...webcamMetadata, id: 'take-1-hologram', role: 'hologram' as never }
    vi.mocked(getAllVideoMetadata).mockResolvedValue([primaryMetadata, future])

    const take = await importTake(primary, addSourceVideo)

    // It belongs to the take and the user can see and delete it; where it would
    // go on the timeline is not a question this build can answer.
    expect(added.map((v) => v.id)).toEqual(['take-1', 'take-1-hologram'])
    expect(take.clipParts.map((part) => part.sourceVideoId)).toEqual(['take-1'])
    expect(take.missingParts).toBe(0)
  })

  it('revokes every thumbnail URL it made when the take fails part-way', async () => {
    vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }))
    vi.mocked(URL.createObjectURL)
      .mockImplementationOnce(() => 'blob:thumb-1')
      .mockImplementationOnce(() => 'blob:thumb-2')
    const failing = vi.fn((video: SourceVideo) => {
      added.push(video)
      if (added.length === 2) throw new Error('library full')
    })

    await expect(importTake(primary, failing)).rejects.toThrow('library full')

    // The URLs escape only on the success path, so a throw is the one moment
    // nothing else will ever see them: the hook's cleanup revokes what
    // importTake returned, and a rejected importTake returns nothing. The hook
    // this module was lifted out of kept its one URL in an effect-scoped
    // variable its cleanup always saw — this is what replaces that.
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.flat()).toEqual([
      'blob:thumb-1',
      'blob:thumb-2',
    ])
  })

  it('counts a companion whose storage read fails as a missing part', async () => {
    vi.mocked(getVideo).mockRejectedValue(new Error('transaction aborted'))

    const take = await importTake(primary, addSourceVideo)

    // How storage lost the companion is not the take's business: an aborted
    // transaction and a deleted row are the same missing part, and neither may
    // cost the take its screen recording — the half-state (primary in the
    // library, nothing on the timeline, "Failed to load recording") is worse
    // than the missing track.
    expect(added.map((v) => v.id)).toEqual(['take-1'])
    expect(take.clipParts.map((part) => part.sourceVideoId)).toEqual(['take-1'])
    expect(take.missingParts).toBe(1)
  })

  it('brings a part in without its thumbnail when the thumbnail read fails', async () => {
    vi.mocked(getThumbnail).mockRejectedValue(new Error('transaction aborted'))

    const take = await importTake(primary, addSourceVideo)

    // A thumbnail is cosmetic: losing one costs a picture, never a track.
    expect(added.map((v) => v.id)).toEqual(['take-1', 'take-1-webcam'])
    expect(added[0].thumbnailUrl).toBeUndefined()
    expect(take.clipParts).toHaveLength(2)
    expect(take.thumbnailUrls).toEqual([])
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('treats a library scan it cannot read as a take of one file', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getAllVideoMetadata).mockRejectedValue(new Error('transaction aborted'))

    const take = await importTake(primary, addSourceVideo)

    // The scan is how companions are *found*, not how the primary arrives — its
    // blob is already in hand. A scan that fails therefore degrades the take to
    // what every pre-ESCSUITE-14 recording already is, one file, rather than
    // costing the user the screen recording the module's own rule protects
    // against every other storage failure.
    expect(added.map((v) => v.id)).toEqual(['take-1'])
    expect(take.clipParts.map((part) => part.sourceVideoId)).toEqual(['take-1'])
    // Nothing was *known* to be missing: an unread scan names no parts, so
    // there is nothing to tell the user they lost.
    expect(take.missingParts).toBe(0)
    expect(consoleWarn).toHaveBeenCalledWith(
      'Could not scan the library for the take companions:',
      expect.any(Error)
    )
  })

  it('lets a primary that cannot be measured fail the take', async () => {
    vi.mocked(resolveStoredDuration).mockRejectedValue(new Error('no duration'))

    // The caller turns this into "Failed to load recording", which is what it
    // has always done — a take with no screen recording is not a take.
    await expect(importTake(primary, addSourceVideo)).rejects.toThrow('no duration')
  })

  /**
   * The waveform (ESCSUITE-71).
   *
   * The media library computes one for every file it imports — both
   * `processVideoFile` and `processAudioFile` call `extractWaveformData` before
   * the entry reaches the store — and the handoff did not, so a take's audio
   * parts sat on the timeline as bare rectangles. Same function, one
   * implementation, and the same place in the sequence: with the library entry,
   * before the take is placed.
   */
  describe('the waveform a part arrives with', () => {
    beforeEach(() => {
      vi.mocked(getAllVideoMetadata).mockResolvedValue([
        primaryMetadata,
        webcamMetadata,
        micMetadata,
      ])
      vi.mocked(getVideo).mockImplementation((id: string) =>
        Promise.resolve({
          blob: storedBlobs[id],
          metadata: id === 'take-1-mic' ? micMetadata : webcamMetadata,
        })
      )
    })

    it('reads each part own bytes through the media library own extractor', async () => {
      await importTake(primary, addSourceVideo)

      // The primary's blob is the one already in hand; each companion's is the
      // one storage handed back for that id. A part decoded from the wrong blob
      // would draw a waveform belonging to another track.
      expect(vi.mocked(extractWaveformData).mock.calls.map(([blob]) => blob)).toEqual([
        primary.blob,
        storedBlobs['take-1-mic'],
      ])
      expect(added.map((v) => v.waveformData?.length)).toEqual([
        PEAKS_PER_TENTH,
        undefined,
        PEAKS_PER_TENTH,
      ])
      // The primary's own mixed audio too, not just the audio companions: the
      // library's import path gives a *video* a waveform, and a handed-over
      // take must not be the one import that looks different.
      expect(added[0].waveformData).toEqual(added[2].waveformData)
    })

    it('never decodes a part ESCAPECRAFT recorded with no audio', async () => {
      await importTake(primary, addSourceVideo)

      // The webcam half of a separate-tracks take has no audio track by
      // construction — the whole mix stays on the primary — and its
      // `hasAudio: false` is the capture's own answer (ESCSUITE-60/62). Decoding
      // a whole video file to be told that is the one cost worth refusing.
      expect(audio.decodeCalls).toHaveLength(2)
      expect(added[1].waveformData).toBeUndefined()
      expect(added[1].hasAudio).toBe(false)
    })

    it('fills in hasAudio for a part stored before ESCAPECRAFT wrote it', async () => {
      const older = { ...micMetadata, hasAudio: undefined }
      vi.mocked(getAllVideoMetadata).mockResolvedValue([primaryMetadata, older])

      await importTake(primary, addSourceVideo)

      // `TimelineTrack` needs both — the flag and the peaks — so a recording
      // made before the flag existed would otherwise have its waveform computed
      // and never drawn.
      expect(added[1].hasAudio).toBe(true)
      expect(added[1].waveformData).toHaveLength(PEAKS_PER_TENTH)
    })

    it('keeps the recorded hasAudio when the take turns out to be silent', async () => {
      audio.buffer = createAudioBufferDouble([samples(0)], 48000)

      await importTake(primary, addSourceVideo)

      // The extractor's `hasAudio` is a silence heuristic (peaks over 0.001),
      // so it may only ever turn the flag *on*: a take recorded in a quiet room
      // must not lose the flag ESCAPECRAFT went to the trouble of persisting.
      // The flat waveform is still drawn, which is the truth about the track.
      expect(added.map((v) => v.hasAudio)).toEqual([true, false, true])
      expect(added[0].waveformData).toHaveLength(PEAKS_PER_TENTH)
    })

    it('leaves a part with no decodable audio without a waveform', async () => {
      audio.buffer = null

      const take = await importTake(primary, addSourceVideo)

      // No peaks rather than an empty array: nothing downstream has to tell a
      // waveform that could not be read from one that is zero samples long.
      expect(added.every((v) => v.waveformData === undefined)).toBe(true)
      expect(added.map((v) => v.hasAudio)).toEqual([true, false, true])
      expect(take.clipParts).toHaveLength(3)
    })

    it('places a part whose waveform cannot be read at all', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(extractWaveformData).mockRejectedValueOnce(new Error('out of memory'))

      const take = await importTake(primary, addSourceVideo)

      // A waveform is cosmetic, exactly like a thumbnail: losing one costs a
      // picture of the sound, never the track. Said out loud, because the
      // extractor's own catch means only a caller can make this happen.
      expect(consoleWarn).toHaveBeenCalledWith(
        'Could not read the waveform for a take part:',
        expect.any(Error)
      )
      expect(added[0].waveformData).toBeUndefined()
      expect(added[2].waveformData).toHaveLength(PEAKS_PER_TENTH)
      expect(take.clipParts).toHaveLength(3)
      expect(take.missingParts).toBe(0)
    })
  })
})
