// Bringing a handed-over take into the media library.
//
// Storage and the media probe are the App suite's recording doubles — this
// module is a collaborator of `useHostIntegration`, mocked the same way there,
// so the two suites see the same boundaries.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { importTake } from './takeImport'
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage'
import { resolveStoredDuration } from '../core/videoProcessor'
import { sampleVideo } from '../test/appDoubles'
import type { SourceVideo } from '../store/types'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
vi.mock('../core/videoProcessor', async () =>
  (await import('../test/appDoubles')).videoProcessorDouble()
)

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

beforeEach(() => {
  added = []
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
})
