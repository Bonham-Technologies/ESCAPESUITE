// Reading a take's parts back out of storage.
//
// Storage is real (fake-indexeddb), because the questions here are storage
// questions: which records belong to this take, in what order, and which of
// them still have bytes behind them. The two callers are the MP4 conversion
// (which wants the camera half and the placement to draw it with) and the host
// upload (which wants every part with its bytes).
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { loadTakeParts, loadWebcamCompanion } from './takeParts'
import { storeVideo, getDB } from '../core/storage'
import { clearAllRecordings } from '../test/recordingsDb'
import { preserveBlobsInStorage } from '../test/blobStorage'
import type { RecordingRole, SourceVideo } from '../store/types'

const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

function metadata(
  id: string,
  role: RecordingRole | undefined,
  extra: Partial<SourceVideo> = {}
): SourceVideo {
  return {
    id,
    name: `Recording — ${role ?? 'take'}`,
    duration: 6,
    width: 1280,
    height: 720,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 100,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_000,
    ...(role !== undefined ? { role } : {}),
    ...extra,
  }
}

/** Store one part with bytes behind it. */
async function seed(id: string, role: RecordingRole | undefined, extra: Partial<SourceVideo> = {}) {
  const record = metadata(id, role, extra)
  await storeVideo(id, new Blob([id], { type: 'video/webm' }), record)
  return record
}

/** A four-part take: screen, camera, microphone, system audio. */
async function seedTake(): Promise<SourceVideo> {
  const primary = await seed('take-1', 'screen', {
    takeId: 'take-1',
    startOffset: 0,
    overlayPlacement: PLACEMENT,
    hasWebcam: true,
  })
  await seed('part-webcam', 'webcam', { takeId: 'take-1', startOffset: 0, hasWebcam: true })
  await seed('part-mic', 'mic', { takeId: 'take-1', startOffset: 0 })
  await seed('part-system', 'system', { takeId: 'take-1', startOffset: 0 })
  return primary
}

// A blob stored here has to be readable when it comes back, or "which part is
// this?" cannot be asked at all — see the fixture for why that needs saying.
preserveBlobsInStorage()

beforeEach(async () => {
  await clearAllRecordings()
})

describe('loadWebcamCompanion', () => {
  it('finds the camera half and carries the primary\'s placement with it', async () => {
    const primary = await seedTake()

    const lookup = await loadWebcamCompanion(primary)

    expect(lookup.kind).toBe('ready')
    if (lookup.kind !== 'ready') throw new Error('unreachable')
    expect(await lookup.companion.blob.text()).toBe('part-webcam')
    // The geometry is the *primary's*: it is the take's, written once at save
    // time, and the camera part carries none of its own.
    expect(lookup.companion.placement).toEqual(PLACEMENT)
    expect(lookup.companion.startOffset).toBe(0)
  })

  it('carries the camera part\'s own startOffset', async () => {
    const primary = await seed('take-2', 'screen', {
      takeId: 'take-2',
      overlayPlacement: PLACEMENT,
    })
    await seed('late-camera', 'webcam', { takeId: 'take-2', startOffset: 1.5 })

    const lookup = await loadWebcamCompanion(primary)

    if (lookup.kind !== 'ready') throw new Error('expected a companion')
    expect(lookup.companion.startOffset).toBe(1.5)
  })

  it('reads a camera part that never said when it started as starting with the take', async () => {
    const primary = await seed('take-5', 'screen', {
      takeId: 'take-5',
      overlayPlacement: PLACEMENT,
    })
    // `startOffset` is optional in storage, and a part written without one says
    // nothing about starting late rather than nothing at all.
    await seed('offsetless-camera', 'webcam', { takeId: 'take-5' })

    const lookup = await loadWebcamCompanion(primary)

    if (lookup.kind !== 'ready') throw new Error('expected a companion')
    expect(lookup.companion.startOffset).toBe(0)
  })

  it('reads nothing at all for a plain take', async () => {
    // A recording made before ESCSUITE-14, or a composited PiP take: no takeId,
    // so there is nothing to look for and no storage read to make.
    const lookup = await loadWebcamCompanion(metadata('plain', undefined))

    expect(lookup).toEqual({ kind: 'none' })
  })

  it('answers none for a take whose camera row was deleted', async () => {
    const primary = await seed('take-3', 'screen', {
      takeId: 'take-3',
      overlayPlacement: PLACEMENT,
    })
    await seed('part-mic-only', 'mic', { takeId: 'take-3' })

    // Deleting the camera row on its own demotes the take to a plain one (see
    // `utils/takeOrder.ts`), so nothing is left out of the MP4 and nothing is
    // worth saying about it.
    expect(await loadWebcamCompanion(primary)).toEqual({ kind: 'none' })
  })

  it('answers none for a primary that carries no placement to draw with', async () => {
    const primary = await seed('take-4', 'screen', { takeId: 'take-4' })
    await seed('orphan-camera', 'webcam', { takeId: 'take-4' })

    // Without the geometry there is nowhere to put the camera. Nothing claims
    // the take ever had one either, so this is an absence rather than a loss.
    expect(await loadWebcamCompanion(primary)).toEqual({ kind: 'none' })
  })

  it('answers unavailable when the camera part is listed and its bytes are gone', async () => {
    const primary = await seedTake()
    const db = await getDB()
    await db.delete('videos', 'part-webcam')
    // Put the metadata back with no blob behind it — a half-failed save, or
    // storage cleared under the tab.
    await db.put('videos', {
      id: 'part-webcam',
      blob: undefined as unknown as Blob,
      metadata: metadata('part-webcam', 'webcam', { takeId: 'take-1' }),
    })

    // Listed but not readable: the MP4 is still worth writing, and the caller
    // is the one that says what is missing from it.
    expect(await loadWebcamCompanion(primary)).toEqual({ kind: 'unavailable' })
  })
})

describe('loadTakeParts', () => {
  it('lists every part with its bytes, the primary first then camera and sound', async () => {
    await seedTake()

    const parts = await loadTakeParts('take-1')

    // Role order, not storage order: every part of a take shares one
    // `recordedAt`, so the timestamp cannot order them and `getAll` returns
    // uuid order, which is a coin toss.
    expect(parts.map((part) => part.role)).toEqual(['screen', 'webcam', 'mic', 'system'])
    expect(parts.map((part) => part.id)).toEqual([
      'take-1',
      'part-webcam',
      'part-mic',
      'part-system',
    ])
    expect(parts.map((part) => part.name)).toEqual([
      'Recording — screen',
      'Recording — webcam',
      'Recording — mic',
      'Recording — system',
    ])
    expect(parts.every((part) => part.startOffset === 0)).toBe(true)
    expect(await parts[1].blob.text()).toBe('part-webcam')
  })

  it('uses the primary\'s bytes the caller already holds instead of reading them again', async () => {
    await seedTake()
    // Deliberately not what storage holds: which Blob comes back is the only
    // way to see whether the record was read a second time. `uploadToHost` has
    // the primary's bytes in hand before it asks for the take — re-reading them
    // is a second full read of (often) the take's largest file, and in a real
    // browser it also yields a *different* `Blob` object, so the message would
    // carry the same bytes twice over.
    const inHand = new Blob(['in-hand'], { type: 'video/webm' })

    const parts = await loadTakeParts('take-1', { primaryBlob: inHand })

    expect(parts[0].id).toBe('take-1')
    expect(parts[0].blob).toBe(inHand)
    expect(await parts[0].blob.text()).toBe('in-hand')
    // Only the primary: every companion is still read from storage, because
    // nobody is holding those.
    expect(parts.map((part) => part.id)).toEqual([
      'take-1',
      'part-webcam',
      'part-mic',
      'part-system',
    ])
    expect(await parts[1].blob.text()).toBe('part-webcam')
  })

  it('lists nothing for a take that is one file', async () => {
    await seed('solo', 'screen', { takeId: 'solo', overlayPlacement: PLACEMENT })

    // `parts` exists to name files a host would not otherwise know about. A
    // list holding only the blob already on `payload.blob` names none of them,
    // so there is nothing to send.
    expect(await loadTakeParts('solo')).toEqual([])
  })

  it('leaves out a part whose bytes are gone rather than listing it empty', async () => {
    await seedTake()
    const db = await getDB()
    await db.put('videos', {
      id: 'part-mic',
      blob: undefined as unknown as Blob,
      metadata: metadata('part-mic', 'mic', { takeId: 'take-1' }),
    })

    // A host reading `parts` iterates blobs; an entry it cannot read is worse
    // than an entry that is not there.
    const parts = await loadTakeParts('take-1')
    expect(parts.map((part) => part.role)).toEqual(['screen', 'webcam', 'system'])
  })

  it('reads a part with no role at all as the take itself', async () => {
    // `takeId` and `role` are written independently (`utils/recordingMetadata`),
    // so a record carrying the first and not the second is a shape storage can
    // hold. It is the take — the primary is the part that is not a companion —
    // and it sorts first rather than being dropped or sent to the back.
    await seed('roleless', undefined, { takeId: 'roleless', overlayPlacement: PLACEMENT })
    await seed('roleless-camera', 'webcam', { takeId: 'roleless' })

    const parts = await loadTakeParts('roleless')

    expect(parts.map((part) => part.role)).toEqual(['screen', 'webcam'])
    expect(parts[0].startOffset).toBe(0)
  })

  it('orders two parts of one rank by id, so the engine\'s sort cannot decide it', async () => {
    await seedTake()
    // Two roles this build has never heard of rank the same, and `getAll`
    // returns them in whatever order storage holds them: the id is the
    // tie-break that makes the answer the same every time.
    await seed('part-zulu', 'zulu' as RecordingRole, { takeId: 'take-1' })
    await seed('part-alpha', 'alpha' as RecordingRole, { takeId: 'take-1' })

    const parts = await loadTakeParts('take-1')

    expect(parts.slice(-2).map((part) => part.id)).toEqual(['part-alpha', 'part-zulu'])
  })

  it('sorts a role it does not know last, without dropping it', async () => {
    await seedTake()
    await seed('part-future', 'captions' as RecordingRole, { takeId: 'take-1' })

    // A part written by a newer ESCAPECRAFT is still the host's to have.
    const parts = await loadTakeParts('take-1')
    expect(parts[parts.length - 1].id).toBe('part-future')
  })
})
