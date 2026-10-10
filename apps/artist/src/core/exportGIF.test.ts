// The GIF export pipeline (ESCSUITE-34).
//
// It shares `core/elementFrames.ts` with the WebM exporter — the media
// elements, the per-frame seek, the one track-ordered draw pass — and swaps the
// encoder: per frame one `getImageData` and one `addFrame`. So what this file
// covers is the frame loop's own arithmetic (how many frames, at what delay,
// over what range), the abort, the failure wrapping, the live size estimate, and
// the one thing that makes GIF different from both video formats: it works with
// no WebCodecs at all.
//
// Real storage, real canvas renderer, real animation engine, real
// `elementFrames`; doubles for the media elements, the 2D context and the
// encoder. `./gifEncoder` is mocked rather than run, because the canvas double's
// `getImageData` answers a 1x1 frame whatever it is asked for — the real encoder
// is exercised by `gifEncoder.test.ts`, which is the only place it needs to be.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToGIF, estimateGifBytes } from './exportGIF'
import { ExportAbortedError, ExportError, type ExportResult } from './exportTypes'
import { extractAndMixAudio } from './audioMixer'
import { storeVideo } from './storage'
import { elementSeekTarget } from './elementSeek'
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { removeWebCodecsGlobals } from '../test/doubles/webcodecs'
import {
  makeClip,
  makeExportOptions,
  makeSourceVideo,
  makeTrack,
} from '../test/fixtures/clipFixtures'
import type { Clip, ExportOptions, ExportProgress, SourceVideo, Track } from '../store/types'

/** One recorded frame handed to the encoder. */
interface GifFrameRecord {
  width: number
  height: number
  delayMs: number
  rgbaLength: number
}

const { gifWriters, createGifWriter, failure, BYTES_PER_FRAME } = vi.hoisted(() => {
  /** Bytes the double pretends each frame costs, so the size estimate is arithmetic a test can predict. */
  const BYTES_PER_FRAME = 100
  interface WriterRecord {
    frames: { width: number; height: number; delayMs: number; rgbaLength: number }[]
    finishes: number
  }
  /**
   * Which `addFrame` call throws, armed **before** the export starts.
   *
   * The brief armed it one microtask in, off `gifWriters`; the export awaits
   * storage inside `loadElementSources` before it builds a writer, so by the
   * time the writer exists several microtasks have passed and the arming is a
   * race. A module-level flag the factory reads needs no guess at all.
   */
  const failure = { onFrame: null as number | null }
  const gifWriters: WriterRecord[] = []
  const createGifWriter = vi.fn(() => {
    const record: WriterRecord = { frames: [], finishes: 0 }
    gifWriters.push(record)
    return {
      addFrame(rgba: Uint8ClampedArray, width: number, height: number, delayMs: number) {
        if (failure.onFrame === record.frames.length) {
          throw new Error('encoder exploded')
        }
        record.frames.push({ width, height, delayMs, rgbaLength: rgba.length })
      },
      bytesWritten: () => record.frames.length * BYTES_PER_FRAME,
      finish: () => {
        record.finishes += 1
        return new Uint8Array(record.frames.length * BYTES_PER_FRAME)
      },
    }
  })
  return { gifWriters, createGifWriter, failure, BYTES_PER_FRAME }
})

vi.mock('./gifEncoder', () => ({ createGifWriter, GIF_MAX_COLORS: 256 }))

vi.mock('./audioMixer', () => ({
  extractAndMixAudio: vi.fn(async () => null),
}))

const mixAudio = vi.mocked(extractAndMixAudio)

/** The writer the export under test used. */
const writer = () => gifWriters[gifWriters.length - 1]
const frames = (): GifFrameRecord[] => writer().frames

let media: MediaDoubles
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

interface RunOptions {
  clips?: Clip[]
  sources?: SourceVideo[]
  options?: Partial<ExportOptions>
  tracks?: Track[]
  signal?: AbortSignal
  projectResolution?: { width: number; height: number }
  onProgress?: (p: ExportProgress) => void
}

/** One second of timeline by default — 15 frames at the default 15 fps. */
const CLIP_DURATION = 1

function run({
  clips = [makeClip({ duration: CLIP_DURATION, endTime: CLIP_DURATION })],
  sources = [makeSourceVideo({ width: 640, height: 360 })],
  options = {},
  tracks = [makeTrack()],
  signal,
  projectResolution = { width: 640, height: 360 },
  onProgress = vi.fn(),
}: RunOptions = {}): Promise<ExportResult> {
  return exportToGIF(
    clips,
    sources,
    makeExportOptions({ format: 'gif', resolution: 'project', ...options }),
    onProgress,
    tracks,
    signal,
    projectResolution
  )
}

const ctx = () => getLastCanvasContext() as RecordingCanvasRenderingContext2D

beforeEach(async () => {
  gifWriters.length = 0
  failure.onFrame = null
  createGifWriter.mockClear()
  mixAudio.mockClear()
  installCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await storeVideo('video1', new Blob([new Uint8Array(8)], { type: 'video/webm' }), makeSourceVideo())
})

afterEach(() => {
  media.uninstall()
  uninstallCanvasDouble()
  warns.mockRestore()
  errors.mockRestore()
})

describe('exportToGIF preconditions', () => {
  it('refuses to export an empty timeline', async () => {
    await expect(run({ clips: [] })).rejects.toThrow('No clips to export')
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('throws ExportAbortedError for a signal that is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(run({ signal: controller.signal })).rejects.toBeInstanceOf(ExportAbortedError)
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('rejects a 0x0 resolved resolution before any encoder is built', async () => {
    // The twin of exportWebM.ts's and exportMP4.ts's own door guard
    // (ESCSUITE-152): a hand-built projectResolution bypasses `parseProject`,
    // and this is clearer than whatever the canvas would do with it.
    const error = await run({ projectResolution: { width: 0, height: 0 } }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toMatch(/resolution/i)
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('refuses a range with no frames in it', async () => {
    // `Math.ceil(0 * fps)` is 0, so the loop would never run and `finish()` would
    // write the trailer byte alone — `gifenc` writes the header lazily on the
    // first frame — handing back a 1-byte file typed `image/gif` after a
    // "complete" report. Same reachability argument as the 2x2 guard above: no
    // shipped caller can produce it today, and a hand-built headless job spec or
    // an empty in/out range can the moment one exists.
    const error = await run({
      clips: [makeClip({ duration: 2, endTime: 2 })],
      options: { timeRange: { start: 0.5, end: 0.5 } },
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toMatch(/range is empty/)
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('refuses a reversed range, which has fewer than no frames', async () => {
    const error = await run({
      clips: [makeClip({ duration: 2, endTime: 2 })],
      options: { timeRange: { start: 1, end: 0.5 } },
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('refuses a frame count that is not finite, rather than looping forever', async () => {
    // The load-bearing half of that same guard, and the half `totalFrames < 1`
    // cannot cover: `Math.ceil(Infinity)` is `Infinity`, which is not `< 1`, so
    // `for (let i = 0; i < Infinity; i++)` would encode until the tab died.
    // Reachable without bypassing the type system — a clip whose `duration` is
    // non-finite (the data shape ESCSUITE-97 had to fix at the source-metadata
    // level) reaches `calculateTimelineDuration`, and `JSON.parse` turns the
    // `1e999` a headless job spec may carry into `Infinity` past every
    // `typeof === 'number'` check `jobSpec.ts` makes.
    const error = await run({
      clips: [makeClip({ duration: Infinity, endTime: Infinity })],
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    // Its own sentence: "a GIF of Infinity frames: the selected range is empty"
    // would name the wrong cause.
    expect((error as ExportError).message).toMatch(/no finite length/)
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('exports with no WebCodecs in the browser at all', async () => {
    // The whole reason the format exists: `gifenc` is pure JavaScript, so this
    // is the one export that works where neither VP9/VP8 nor H.264 can be
    // configured. The two video exporters both refuse outright here.
    const restore = removeWebCodecsGlobals()

    const { blob } = await run()

    expect(blob.type).toBe('image/gif')
    expect(frames()).toHaveLength(15)

    restore()
  })

  it('never extracts audio: a GIF has none', async () => {
    await run()

    // Not "extracts it and throws it away" — mixing the whole timeline's audio
    // is the most expensive no-op in the pipeline.
    expect(mixAudio).not.toHaveBeenCalled()
  })
})

describe('exportToGIF frames', () => {
  it('produces an image/gif blob carrying the encoder’s bytes, and reports no sound', async () => {
    const { blob, audio } = await run()

    expect(blob.type).toBe('image/gif')
    expect(blob.size).toBe(15 * BYTES_PER_FRAME)
    expect(writer().finishes).toBe(1)
    // ESCSUITE-175: the one format whose result always says the sound was
    // dropped, because the container has nowhere to put it.
    expect(audio).toBe(false)
  })

  it('writes one frame per output frame at the default 15 fps', async () => {
    await run()

    // 1 second at 15 fps. 1000/15 = 66.67 ms, rounded to 67 — which the GIF
    // container then stores as 7 centiseconds (see gifEncoder.test.ts).
    expect(frames()).toHaveLength(15)
    expect(frames().map((f) => f.delayMs)).toEqual(Array(15).fill(67))
  })

  it.each([
    [10, 10, 100],
    [15, 15, 67],
    [20, 20, 50],
  ])('writes %s frames at %s fps with a %s ms delay', async (_count, fps, delayMs) => {
    await run({ options: { fps: fps as ExportOptions['fps'] } })

    expect(frames()).toHaveLength(fps)
    expect(frames()[0].delayMs).toBe(delayMs)
  })

  it('falls back to 15 fps for a rate it does not offer', async () => {
    await run({ options: { fps: 7 as unknown as ExportOptions['fps'] } })

    expect(frames()).toHaveLength(15)
  })

  it('writes each frame at the resolved output size', async () => {
    await run({
      clips: [makeClip({ duration: 0.2, endTime: 0.2 })],
      options: { resolution: '360p' },
      projectResolution: { width: 1280, height: 720 },
    })

    // 360p of a 16:9 project is 640x360, and the canvas is sized to it.
    expect(frames()[0]).toMatchObject({ width: 640, height: 360 })
    expect(ctx().canvas.width).toBe(640)
    expect(ctx().canvas.height).toBe(360)
  })

  it('reads the whole raster back once per frame', async () => {
    await run({ clips: [makeClip({ duration: 0.2, endTime: 0.2 })] })

    // 0.2 s at 15 fps is 3 frames. One getImageData each, over the full output
    // raster — `getImageData` ignores the current transform, so the frame handed
    // to the encoder is the output raster including any letterbox bar.
    expect(ctx().argsFor('getImageData')).toEqual([
      [0, 0, 640, 360],
      [0, 0, 640, 360],
      [0, 0, 640, 360],
    ])
  })

  it('honours timeRange, so Export Section works unchanged', async () => {
    await run({
      clips: [makeClip({ duration: 2, endTime: 2 })],
      options: { fps: 10, timeRange: { start: 0.5, end: 1 } },
    })

    // Half a second at 10 fps.
    expect(frames()).toHaveLength(5)
    // The first frame drew the clip at timeline time 0.5, which is the source's
    // own 0.5 — so the element was seeked there (just past it, ESCSUITE-265)
    // rather than to 0.
    expect(media.seeks).toContain(elementSeekTarget(0.5))
  })

  it('clears each frame to black before compositing, and reads it back after', async () => {
    await run({ clips: [makeClip({ duration: 0.2, endTime: 0.2 })] })

    const fills = ctx().argsFor('fillRect')
    expect(fills).toHaveLength(3)
    expect(fills[0]).toEqual([0, 0, 640, 360])
    expect(ctx().stateFor('fillRect')[0].fillStyle).toBe('#000000')

    // Order, not just count. The two export ceiling files pin `openOutputFrame`
    // as exactly once per frame but **not** as the frame's first call (their
    // splitter buckets on the pair wherever it falls), and this pipeline reads
    // the raster back: a clear that landed after the draws, or a read-back taken
    // before them, would hand the encoder fifteen black frames and every count
    // in this file would still be green.
    const calls = ctx().calls
    const opens = calls.reduce<number[]>((indices, call, index) => {
      if (call.method === 'fillRect' && String(call.args) === String([0, 0, 640, 360])) {
        indices.push(index)
      }
      return indices
    }, [])
    expect(opens).toHaveLength(3)

    const bounds = [...opens, calls.length]
    for (let frame = 0; frame < opens.length; frame++) {
      const methods = calls.slice(bounds[frame], bounds[frame + 1]).map((c) => c.method)
      // The frame opens on its clear (index 0), so a draw anywhere after it is
      // a draw onto a cleared raster.
      expect(methods.indexOf('drawImage')).toBeGreaterThan(0)
      // And the read-back follows the last of them.
      expect(methods.indexOf('getImageData')).toBeGreaterThan(methods.lastIndexOf('drawImage'))
    }
  })

  it('falls back to one default track and the base dimensions with neither argument', async () => {
    // `tracks` and `projectResolution` are both optional on the signature, and
    // `exportToWebM`'s own suite covers the same two fallbacks: without tracks
    // the exporter synthesises one visible video track, and without a project
    // resolution 'project' resolves to `getBaseDimensions`' answer — the bottom
    // media clip's own source size, 640x360 here.
    //
    // The clip sits on `'default'` on purpose. `getClipsAtTime` resolves a clip
    // against the track list it is handed and drops a clip whose track is not in
    // it, so a drawn frame is what proves the *synthesised* track is the one the
    // composer composited against, rather than merely that the fallback
    // expression evaluated.
    const { blob } = await exportToGIF(
      [makeClip({ trackId: 'default', duration: 0.2, endTime: 0.2 })],
      [makeSourceVideo({ width: 640, height: 360 })],
      makeExportOptions({ format: 'gif', resolution: 'project' }),
      vi.fn()
    )

    expect(blob.type).toBe('image/gif')
    expect(frames()).toHaveLength(3)
    expect(frames()[0]).toMatchObject({ width: 640, height: 360 })
    expect(ctx().canvas.width).toBe(640)
    expect(ctx().canvas.height).toBe(360)
    // Drawn, not just sized: the default track carried the clip.
    expect(ctx().argsFor('drawImage')).toHaveLength(3)
    // And the *drawing space* fell back too, which the output size alone cannot
    // show — `getResolution` has a source fallback of its own, so the raster
    // would be 640x360 either way. With no project resolution the project space
    // **is** the base dimensions, so `openOutputFrame`'s matrix is the identity;
    // any other fallback would scale every draw call.
    expect(ctx().argsFor('setTransform')[0]).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('draws both sides of an active transition', async () => {
    // GIF drives `elementFrames.ts`'s composer, so it gets the transition pass —
    // and with it ESCSUITE-133's clamped incoming clip time and ESCSUITE-139's
    // preset suppression — for free rather than by reimplementation. The shape
    // is `exportWebM.test.ts`'s own transition case: clip `a` carries a fade as
    // long as itself, so the transition is active from timeline 0, and the frame
    // inside that window draws both clips instead of one.
    await storeVideo('video2', new Blob([new Uint8Array(8)], { type: 'video/webm' }), makeSourceVideo({ id: 'video2' }))

    await run({
      clips: [
        makeClip({
          id: 'a',
          duration: 0.2,
          endTime: 0.2,
          timelinePosition: 0,
          transition: { type: 'fade', duration: 0.2 },
        }),
        makeClip({
          id: 'b',
          sourceVideoId: 'video2',
          duration: 0.2,
          endTime: 0.2,
          timelinePosition: 0.2,
        }),
      ],
      sources: [
        makeSourceVideo({ width: 640, height: 360 }),
        makeSourceVideo({ id: 'video2', width: 640, height: 360 }),
      ],
      options: { fps: 10, timeRange: { start: 0, end: 0.1 } },
    })

    // One frame, two draws: the outgoing clip and the incoming one, not one
    // clip and a black half.
    expect(frames()).toHaveLength(1)
    expect(ctx().argsFor('drawImage')).toHaveLength(2)
    const alphas = ctx().stateFor('drawImage').map((s) => s.globalAlpha)
    expect(alphas[0]).toBe(1)
    expect(alphas[1]).toBe(0)
  })

  it('exports an audio-only project as the cleared raster, and completes', async () => {
    // `loadElementSources` skips an audio source — there is nothing to draw from
    // it — so every frame is the black `openOutputFrame` painted. That is the
    // intended outcome and not an accident: a valid, silent, all-black GIF under
    // a "complete" report, rather than a refusal. A GIF has no audio track to
    // put the sound in, and refusing would be refusing a timeline the two video
    // formats export happily.
    await storeVideo('audio1', new Blob([new Uint8Array(8)], { type: 'audio/mp4' }), makeSourceVideo({ id: 'audio1' }))

    const { blob } = await run({
      clips: [makeClip({ sourceVideoId: 'audio1', duration: 0.3, endTime: 0.3 })],
      sources: [makeSourceVideo({ id: 'audio1', mediaType: 'audio', width: 0, height: 0 })],
      options: { fps: 10 },
    })

    expect(blob.type).toBe('image/gif')
    expect(frames()).toHaveLength(3)
    expect(frames()[0]).toMatchObject({ width: 640, height: 360 })
    // Cleared once per frame and never drawn into.
    expect(ctx().argsFor('fillRect')).toHaveLength(3)
    expect(ctx().argsFor('drawImage')).toHaveLength(0)
    expect(writer().finishes).toBe(1)
  })

  it('releases every media element when it finishes', async () => {
    vi.mocked(URL.revokeObjectURL).mockClear()

    await run({ clips: [makeClip({ duration: 0.2, endTime: 0.2 })] })

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('exportToGIF progress', () => {
  it('reports a live size estimate once frames have been written', async () => {
    const reports: ExportProgress[] = []

    await run({ clips: [makeClip({ duration: 1, endTime: 1 })], onProgress: (p) => reports.push(p) })

    const withEstimate = reports.filter((p) => p.estimatedBytes !== undefined)
    expect(withEstimate.length).toBeGreaterThan(0)
    // bytes so far / frames done x frames total. The double charges 100 bytes a
    // frame, so for 15 frames every estimate is 1500 exactly.
    expect(withEstimate.map((p) => p.estimatedBytes)).toEqual(
      withEstimate.map(() => 15 * BYTES_PER_FRAME)
    )
  })

  it('leaves the estimate off the reports made before the first frame', async () => {
    const reports: ExportProgress[] = []

    await run({ onProgress: (p) => reports.push(p) })

    // Dividing by zero frames would put Infinity or NaN on screen; the dialog
    // shows `estimateGifBytes`'s own heuristic until the loop has written one.
    expect(reports[0].estimatedBytes).toBeUndefined()
    expect(reports[0].phase).toBe('preparing')
  })

  it('finishes at phase complete and 100%', async () => {
    const reports: ExportProgress[] = []

    await run({ onProgress: (p) => reports.push(p) })

    expect(reports[reports.length - 1]).toMatchObject({ phase: 'complete', progress: 100 })
  })
})

describe('exportToGIF abort', () => {
  it('stops between frames, keeping the frames already written', async () => {
    const controller = new AbortController()
    // Progress is reported every 5 frames, so aborting from the first report
    // lands between frame 5 and frame 6.
    const onProgress = (p: ExportProgress) => {
      if (p.phase === 'encoding' && p.message.includes('5/10')) controller.abort()
    }

    await expect(
      run({ options: { fps: 10 }, signal: controller.signal, onProgress })
    ).rejects.toBeInstanceOf(ExportAbortedError)

    expect(frames()).toHaveLength(5)
    expect(writer().finishes).toBe(0)
  })

  it('releases the media elements on abort', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.mocked(URL.revokeObjectURL).mockClear()

    await expect(run({ signal: controller.signal })).rejects.toBeInstanceOf(ExportAbortedError)

    // Aborted before any element was loaded, so nothing to revoke — the point of
    // the case is that the early abort does not leave a half-built export.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('releases the media elements on an abort from inside the frame loop', async () => {
    const controller = new AbortController()
    const onProgress = (p: ExportProgress) => {
      if (p.phase === 'encoding' && p.message.includes('5/10')) controller.abort()
    }
    vi.mocked(URL.revokeObjectURL).mockClear()

    await expect(
      run({ options: { fps: 10 }, signal: controller.signal, onProgress })
    ).rejects.toBeInstanceOf(ExportAbortedError)

    // The one that matters: by then an element really is loaded, so the abort
    // path has something to free.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('exportToGIF failures', () => {
  it('wraps an encoder failure in ExportError with the log and the frame it reached', async () => {
    failure.onFrame = 2

    const error = await run({ options: { fps: 10 } }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toBe('encoder exploded')
    expect((error as ExportError).frameIndex).toBe(2)
    expect((error as ExportError).totalFrames).toBe(10)
    expect((error as ExportError).exportLog.length).toBeGreaterThan(0)
  })

  it('releases the media elements when a frame fails', async () => {
    failure.onFrame = 0
    vi.mocked(URL.revokeObjectURL).mockClear()

    await expect(run({ options: { fps: 10 } })).rejects.toBeInstanceOf(ExportError)

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  // ESCSUITE-156. The same gap `exportWebM.ts` had, narrower: between the media
  // load and the frame loop's `try` sit the rewind, the composer and the
  // writer, and a throw from any of them left every loaded element behind.
  it('releases the media elements when the writer cannot be built', async () => {
    createGifWriter.mockImplementationOnce(() => {
      throw new Error('gifenc exploded')
    })
    vi.mocked(URL.revokeObjectURL).mockClear()

    const error = await run({ options: { fps: 10 } }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toBe('gifenc exploded')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  // ESCSUITE-159. `releaseElementSources` runs once the GIF is finished, and the
  // one thing left after it — the caller's own `complete` report — reaches the
  // catch when it throws, which releases again: two `revokeObjectURL` calls per
  // source for one export. `exportWebM.ts` had the same pair.
  it('releases each media element once when the completion callback throws', async () => {
    vi.mocked(URL.revokeObjectURL).mockClear()
    const onProgress = (p: ExportProgress) => {
      if (p.phase === 'complete') throw new Error('dialog blew up')
    }

    await expect(run({ options: { fps: 10 }, onProgress })).rejects.toThrow('dialog blew up')

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('estimateGifBytes', () => {
  it('is pixels x frames x 0.3 bytes, the up-front heuristic', () => {
    // What the dialog shows before a single frame exists. Deliberately crude:
    // a GIF's real size depends on how much of each frame actually changes.
    expect(estimateGifBytes(640, 360, 15)).toBe(Math.round(640 * 360 * 15 * 0.3))
  })

  it('is zero for an export with no frames', () => {
    expect(estimateGifBytes(640, 360, 0)).toBe(0)
  })
})
