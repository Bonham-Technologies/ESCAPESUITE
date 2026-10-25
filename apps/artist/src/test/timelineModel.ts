// The model behind `store/__tests__/timelineInvariants.property.test.ts`
// (ESCSUITE-349): the timeline edits a user can make, each driven through the
// same code path the editor's own gesture takes, and the invariants that must
// hold after every one of them. Under `src/test/` so coverage scores it as
// scaffolding, not as production code.
//
// **Adding an operation.** Add a member to `Op`, an arbitrary for it in
// `opArbitrary` (in the property test), and a `case` in `applyOneOp` that drives
// the store the way the editor's gesture does (the hook or helper the
// component calls, not a shortcut through `useEditorStore.setState`). Then say
// what it may change in `checkPostcondition`: every clip the op does not name
// must come out of it unchanged unless the case says otherwise. The
// per-step invariants in `checkInvariants` apply to the new op with no
// further work.
import { expect, vi } from 'vitest'
import { useEditorStore } from '../store/projectStore'
import { clampTrimToNeighbours, getSnapPoints, overlapsSpan, trackRefusesDrop, wouldOverlap } from '../store/timelineSnapping'
import { computeTrimUpdate, getSplitOffset, PIXELS_PER_SECOND_BASE, snapDragPosition } from '../components/Timeline/timelineGeometry'
import { createGestureHistory } from '../hooks/useGestureHistory'
import { isExtendableClip } from '../store/extendableClip'
import { getPeaksForRange } from '../utils/waveform'
import { loadProject, saveProject } from '../core/projectManager'
import { readProjectFileIndex } from '../core/projectFileFormat'
import { parseProject } from '../store/projectMigration'
import { applyEditorBlock, currentEditorBlock } from '../app/editorBlock'
import { mediaFile } from './doubles/files'
import type { Clip, EditorState, SourceVideo, WaveformPeak } from '../store/types'

/** Below a frame, below MIN_CLIP_DURATION: the tolerance float arithmetic needs. */
export const EPS = 1e-9

// ---------------------------------------------------------------------------
// The media the model edits.

/** Deterministic peaks: a source's waveform is a function of its id. */
function peaksFor(seed: number, count: number): WaveformPeak[] {
  return Array.from({ length: count }, (_, i) => {
    // Never 0: JSON writes -0 as 0, so a `min: -0` would not survive a save.
    const v = (((i * 7919 + seed * 104729) % 999) + 1) / 1000
    return { min: -v, max: v }
  })
}

const base = { frameRate: 30, size: 16 } as const

/**
 * The pool `add` draws from. Two videos with embedded audio, one audio-only
 * file (all three carry waveform peaks) and one image, so the extendable
 * (`startTime` 0 / `endTime` duration) paths of split and trim are reached too.
 * Durations are deliberately not round numbers.
 */
export const SOURCES: readonly SourceVideo[] = [
  { ...base, id: 'pv-a', name: 'a.mp4', duration: 10, width: 64, height: 48, mimeType: 'video/mp4', mediaType: 'video', hasAudio: true, waveformData: peaksFor(1, 100) },
  { ...base, id: 'pv-b', name: 'b.webm', duration: 6.37, width: 64, height: 48, mimeType: 'video/webm', mediaType: 'video', hasAudio: true, waveformData: peaksFor(2, 64) },
  { ...base, id: 'pv-c', name: 'c.wav', duration: 4.5, width: 0, height: 0, frameRate: 0, mimeType: 'audio/wav', mediaType: 'audio', hasAudio: true, waveformData: peaksFor(3, 45) },
  { ...base, id: 'pv-d', name: 'd.png', duration: 5, width: 64, height: 48, frameRate: 1, mimeType: 'image/png', mediaType: 'image' },
]

const fixtureSource = (id: string) => SOURCES.find((s) => s.id === id)

// ---------------------------------------------------------------------------
// Operations.

/** Where a move drops a clip: a time on a chosen row, or against another clip. */
export type MoveTarget =
  | { kind: 'at'; track: number; time: number }
  | { kind: 'beside'; other: number; side: 'before' | 'after' | 'onto' }

/**
 * One user edit. `clip` / `other` / `source` / `track` are indices, taken
 * modulo the list they pick from at the moment the op runs, so any sequence
 * is valid and shrinks to a smaller valid one.
 */
export type Op =
  | { kind: 'add'; source: number; at: number }
  | { kind: 'split'; clip: number; frac: number }
  | { kind: 'delete'; clip: number }
  | { kind: 'rippleDelete'; clip: number }
  | { kind: 'move'; clip: number; to: MoveTarget }
  | { kind: 'trim'; clip: number; edge: 'start' | 'end'; ripple: boolean; moves: number[] }
  | { kind: 'duplicate'; clip: number }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'saveLoad' }

const state = (): EditorState => useEditorStore.getState()
const clipsNow = (): Clip[] => state().project.timeline.clips
const pick = <T>(list: readonly T[], index: number): T | undefined =>
  list.length === 0 ? undefined : list[index % list.length]

let clipSerial = 0

// ---------------------------------------------------------------------------
// Known bugs.

/**
 * A sequence reached the trigger of a bug already filed. The property test
 * catches it and discards the sequence (`fc.pre(false)`), so a known bug
 * cannot turn `main` red when a generator change makes fast-check draw
 * different sequences. `timelineInvariants.counterexamples.test.ts` runs each
 * bug with the guards off, as an `it.fails` test, so it keeps being exercised.
 * **A fix PR deletes its ticket's guard below and flips its `it.fails` to `it`.**
 */
export class KnownBug extends Error {
  constructor(readonly ticket: string, detail: string) {
    super(`${ticket}: ${detail}`)
    this.name = 'KnownBug'
  }
}

/** Whether the known-bug guards are on. The counterexample tests turn them off. */
let guards = true

/**
 * Throw `KnownBug` for `ticket` while the guards are on. Exported so the
 * mechanism stays compiled while no bug is guarded: the next filed bug's
 * guard calls it from `applyOneOp`.
 */
export function knownBug(ticket: string, detail: string): void {
  if (guards) throw new KnownBug(ticket, detail)
}

/** A fresh editor: the empty project the app starts with, no history. */
export function resetModel({ guards: on = true }: { guards?: boolean } = {}): void {
  guards = on
  clipSerial = 0
  state().resetProject()
  useEditorStore.setState({
    history: { past: [], future: [] },
    zoom: 1,
    snapEnabled: true,
    activeTool: 'select',
  })
  model.past = []
  model.future = []
}

/**
 * The model's own undo stack: the project, as JSON, before every edit that
 * pushed an entry. `undo` must land on exactly the top of it.
 */
const model = { past: [] as string[], future: [] as string[] }
const MAX_HISTORY_SIZE = 50 // storeHistory.ts

const projectJson = () => JSON.stringify(state().project)

// ---------------------------------------------------------------------------
// The gestures, as the editor runs them.

/** `VideoUploader.handleAddToTimeline`, at a playhead of `at`. */
function add(op: Extract<Op, { kind: 'add' }>): void {
  const source = pick(SOURCES, op.source)!
  // The library's re-import: a load keeps only the sources its clips use, and
  // the bytes are still in the shared DB, so the media is added back first.
  if (!state().sourceVideos.some((v) => v.id === source.id)) state().addSourceVideo(structuredClone(source))
  const duration = source.mediaType === 'image' ? 5 : source.duration // DEFAULT_IMAGE_DURATION
  state().addClipToTimeline(
    { id: `clip-${++clipSerial}`, sourceVideoId: source.id, name: source.name, startTime: 0, endTime: duration, duration },
    undefined,
    op.at
  )
}

/** The razor: `useClipDrag.handleRazorClick` at a point `frac` of the way along the clip. */
function split(op: Extract<Op, { kind: 'split' }>): void {
  const clip = pick(clipsNow(), op.clip)
  if (!clip) return
  const clickTime = clip.timelinePosition + op.frac * clip.duration
  const offset = getSplitOffset(clickTime, clip.timelinePosition, clip.duration)
  if (offset !== null) state().splitClip(clip.id, offset)
}

/** `useClipDrag`'s mouseup for a single clip, snapping as the editor does by default. */
function move(op: Extract<Op, { kind: 'move' }>): void {
  const clips = clipsNow()
  const clip = pick(clips, op.clip)
  if (!clip) return
  const { tracks } = state().project.timeline

  let trackId: string
  let raw: number
  if (op.to.kind === 'at') {
    trackId = pick(tracks, op.to.track)!.id
    raw = op.to.time
  } else {
    const other = pick(clips, op.to.other)!
    trackId = other.trackId
    raw =
      op.to.side === 'after'
        ? other.timelinePosition + other.duration
        : op.to.side === 'before'
          ? other.timelinePosition - clip.duration
          : other.timelinePosition
  }

  // handleMouseMove: clamp to 0, then snap against the edges taken on mousedown.
  let position = Math.max(0, raw)
  const s = state()
  if (s.snapEnabled) {
    const pixelsPerSecond = PIXELS_PER_SECOND_BASE * s.zoom
    position = snapDragPosition(position, clip.duration, getSnapPoints(clips, clip.id), s.snapThreshold / pixelsPerSecond).position
  }

  // handleMouseUp, single-clip branch.
  if (trackRefusesDrop(tracks, trackId)) return
  if (wouldOverlap(clips, trackId, position, clip.duration, clip.id)) return
  const movedTrack = trackId !== clip.trackId
  if (movedTrack && !s.moveClipToTrack(clip.id, trackId)) return
  if (position - clip.timelinePosition !== 0) s.setClipTimelinePosition(clip.id, position, movedTrack)
}

/**
 * `useTrimDrag`: a mousedown on one edge, one write per pointer move through
 * the gesture's history, and — with the ripple tool — the downstream shift on
 * mouseup. `moves` are pointer times relative to the dragged edge.
 */
function trim(op: Extract<Op, { kind: 'trim' }>): void {
  const start = pick(clipsNow(), op.clip)
  if (!start) return
  const origin = {
    startTime: start.startTime,
    endTime: start.endTime,
    timelinePosition: start.timelinePosition,
    animation: start.animation,
  }
  const edgeTime = op.edge === 'start' ? start.timelinePosition : start.timelinePosition + start.duration
  const gesture = createGestureHistory()
  gesture.begin()

  for (const delta of op.moves) {
    const clips = clipsNow()
    const clip = clips.find((c) => c.id === start.id)!
    const sourceVideo = state().sourceVideos.find((v) => v.id === clip.sourceVideoId)
    const mouseTime = edgeTime + delta
    const limited =
      op.ripple && op.edge === 'end' ? mouseTime : clampTrimToNeighbours(clips, clip, op.edge, origin, mouseTime)
    const update = computeTrimUpdate({ edge: op.edge, mouseTime: limited, clip, sourceVideo, origin })
    const changes = update && (Object.keys(update) as (keyof Clip)[]).some((k) => clip[k] !== update[k])
    if (update && changes) {
      gesture.commit((skipHistory) => state().trimClip(clip.id, op.edge, update, origin, skipHistory))
    }
  }

  if (op.ripple) {
    const clip = clipsNow().find((c) => c.id === start.id)!
    const originalEnd = origin.timelinePosition + (origin.endTime - origin.startTime)
    const currentEnd = clip.timelinePosition + (clip.endTime - clip.startTime)
    const delta = currentEnd - originalEnd
    if (delta !== 0) gesture.commit((skipHistory) => state().shiftClipsAfter(clip.trackId, originalEnd, delta, skipHistory))
  }
  gesture.end()
}

/** The download `saveProject` starts, as the bytes it hands to `URL.createObjectURL`. */
async function capturedSave(): Promise<Uint8Array> {
  // `URL.createObjectURL` is the setup file's recording double. Cleared first,
  // so the calls it holds are this save's and thousands of saves do not pile up.
  const createObjectURL = vi.mocked(URL.createObjectURL)
  createObjectURL.mockClear()
  const s = state()
  await saveProject(s.project, s.sourceVideos, undefined, currentEditorBlock())
  const blob = createObjectURL.mock.calls.map(([arg]) => arg).find((arg): arg is Blob => arg instanceof Blob)
  expect(blob, 'saveProject produced a download').toBeDefined()
  return new Uint8Array(await blob!.arrayBuffer())
}

/** The index of a saved file with `project.modified` blanked: a load stamps it with the time. */
async function normalisedIndex(bytes: Uint8Array): Promise<{ index: string; payload: number[] }> {
  const file = mediaFile([bytes as BlobPart], 'p.veditor', 'application/octet-stream')
  const read = await readProjectFileIndex(file)
  expect(read, 'the save is a v2 container').not.toBeNull()
  const index = structuredClone(read!.index)
  index.project = { ...index.project, modified: 0 }
  return { index: JSON.stringify(index), payload: Array.from(bytes.subarray(read!.payloadStart)) }
}

/**
 * Save, then open the file — `useProjectActions.loadProjectFile`'s sequence,
 * on the real `.veditor` writer and reader — then save again. The two saves
 * must agree (exception: `project.modified`, which a load stamps), and the
 * loaded project must be the one that was saved.
 */
async function saveLoad(): Promise<void> {
  const before = state()
  const savedProject = { ...before.project, modified: 0 }
  const usedIds = new Set(before.project.timeline.clips.map((c) => c.sourceVideoId))
  const savedSources = before.sourceVideos.filter((v) => usedIds.has(v.id))
  const first = await capturedSave()

  const loaded = await loadProject(mediaFile([first as BlobPart], 'p.veditor', 'application/octet-stream'))
  const parsed = parseProject(loaded.project, loaded.editor)
  if (!parsed.ok) throw new Error(`the editor's own save was refused on load: ${parsed.reason}`)
  state().resetProject()
  state().setProject(parsed.project)
  for (const video of loaded.sourceVideos) state().addSourceVideo(video)
  if (parsed.editor) applyEditorBlock(parsed.editor)
  state().clearHistory()
  model.past = []
  model.future = []

  // The load hands back what was saved.
  expect(JSON.stringify({ ...state().project, modified: 0 }), 'the loaded project is the saved one').toBe(JSON.stringify(savedProject))
  const restored = state().sourceVideos.map(({ id, duration, mediaType, hasAudio, waveformData }) => ({ id, duration, mediaType, hasAudio, waveformData }))
  const expected = savedSources.map(({ id, duration, mediaType, hasAudio, waveformData }) => ({ id, duration, mediaType, hasAudio, waveformData }))
  expect(restored, 'the loaded library is the saved one').toEqual(expected)

  // serialize -> load -> serialize.
  const second = await capturedSave()
  const [a, b] = await Promise.all([normalisedIndex(first), normalisedIndex(second)])
  expect(b.index, 'a second save of the loaded project writes the same index').toBe(a.index)
  expect(b.payload, 'and the same media bytes').toEqual(a.payload)
}

// ---------------------------------------------------------------------------
// Running a sequence.

/** Snapshot of everything an op may be judged on. */
interface Before {
  clips: Clip[]
  past: unknown
  pastLength: number
  json: string
}

function snapshot(): Before {
  const s = state()
  return {
    clips: structuredClone(s.project.timeline.clips),
    past: s.history.past[s.history.past.length - 1],
    pastLength: s.history.past.length,
    json: projectJson(),
  }
}

/**
 * How many ops ran, and how many of each kind changed the project or the
 * library. The property test holds these to a floor after its run, so a
 * generator that stops producing real edits fails rather than passing on
 * no-ops.
 */
export const opCounts = { total: 0, changed: {} as Partial<Record<Op['kind'], number>> }

const libraryJson = () => JSON.stringify(state().sourceVideos.map((v) => v.id))

export async function applyOp(op: Op): Promise<void> {
  const projectBefore = projectJson()
  const libraryBefore = libraryJson()
  try {
    await applyOneOp(op)
  } finally {
    opCounts.total++
    if (projectJson() !== projectBefore || libraryJson() !== libraryBefore) {
      opCounts.changed[op.kind] = (opCounts.changed[op.kind] ?? 0) + 1
    }
  }
}

async function applyOneOp(op: Op): Promise<void> {
  const before = snapshot()

  switch (op.kind) {
    case 'add': add(op); break
    case 'split': split(op); break
    case 'delete': {
      const clip = pick(clipsNow(), op.clip)
      if (clip) state().removeClipFromTimeline(clip.id)
      break
    }
    case 'rippleDelete': {
      const clip = pick(clipsNow(), op.clip)
      if (clip) state().rippleDeleteClip(clip.id)
      break
    }
    case 'move': move(op); break
    case 'trim': trim(op); break
    case 'duplicate': {
      const clip = pick(clipsNow(), op.clip)
      if (clip) state().duplicateClip(clip.id)
      break
    }
    case 'undo': {
      const could = state().history.past.length > 0
      state().undo()
      if (could) {
        // The model never loses an entry the store still holds: both cap at 50.
        const expected = model.past.pop()
        expect(projectJson(), 'undo lands on the project as it stood before the last edit').toBe(expected)
        model.future.unshift(before.json)
      }
      return
    }
    case 'redo': {
      const could = state().history.future.length > 0
      state().redo()
      if (could) {
        const expected = model.future.shift()
        expect(projectJson(), 'redo lands on the project the undo left').toBe(expected)
        model.past.push(before.json)
      }
      return
    }
    case 'saveLoad': await saveLoad(); return
  }

  // Did the op push an undo entry? (Identity, not length: the stack caps at 50.)
  const s = state()
  if (s.history.past[s.history.past.length - 1] !== before.past || s.history.past.length !== before.pastLength) {
    model.past.push(before.json)
    if (model.past.length > MAX_HISTORY_SIZE) model.past.shift()
    model.future = []
  }

  checkPostcondition(op, before, s.project.timeline.clips)
}

// ---------------------------------------------------------------------------
// What each op may change.

const byId = (clips: Clip[]) => new Map(clips.map((c) => [c.id, c]))
/**
 * A plain throw rather than `expect`: the invariants run thousands of checks a
 * sequence, and an `expect` per check was most of the suite's runtime.
 */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}
const close = (a: number, b: number, what: string) =>
  check(Math.abs(a - b) <= EPS, `${what}: ${a} vs ${b} (off by ${Math.abs(a - b)})`)
const isExtendable = (clip: Clip) => isExtendableClip(clip, fixtureSource(clip.sourceVideoId))

/** Every clip in `before` but not in `except` is in `after`, unchanged — save the fields `allow` lets differ. */
function othersUnchanged(before: Clip[], after: Clip[], except: Set<string>, allow: (c: Clip) => Partial<Clip> = () => ({})) {
  const now = byId(after)
  for (const clip of before) {
    if (except.has(clip.id)) continue
    const found = now.get(clip.id)
    check(found !== undefined, `clip ${clip.id} survives an edit that does not name it`)
    const expected = { ...clip, ...allow(clip) }
    // The JSON comparison is the fast path; `toEqual` is there for its diff.
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      expect(found, `clip ${clip.id} is unchanged by an edit that does not name it`).toEqual(expected)
    }
  }
}

/** The source time a media clip plays at timeline time 0: what keeps a clip's picture and sound in place. */
const anchor = (c: Clip) => c.startTime - c.timelinePosition

function checkPostcondition(op: Op, before: Before, after: Clip[]): void {
  const prior = byId(before.clips)
  const added = after.filter((c) => !prior.has(c.id))
  const removed = before.clips.filter((c) => !after.some((a) => a.id === c.id))

  switch (op.kind) {
    case 'add':
      expect(removed).toEqual([])
      othersUnchanged(before.clips, after, new Set())
      return
    case 'delete':
      expect(added).toEqual([])
      expect(removed.length).toBeLessThanOrEqual(1)
      othersUnchanged(before.clips, after, new Set(removed.map((c) => c.id)))
      return
    case 'rippleDelete': {
      expect(added).toEqual([])
      expect(removed.length).toBeLessThanOrEqual(1)
      const [gone] = removed
      if (!gone) return othersUnchanged(before.clips, after, new Set())
      const end = gone.timelinePosition + (gone.endTime - gone.startTime)
      const length = gone.endTime - gone.startTime
      // A clip within EPS of the gap's end is after it too (ESCSUITE-364).
      othersUnchanged(before.clips, after, new Set([gone.id]), (c) =>
        c.trackId === gone.trackId && c.timelinePosition >= end - EPS
          ? { timelinePosition: Math.max(0, c.timelinePosition - length) }
          : {}
      )
      return
    }
    case 'split': {
      if (removed.length === 0) return othersUnchanged(before.clips, after, new Set())
      expect(removed).toHaveLength(1)
      expect(added).toHaveLength(2)
      const [whole] = removed
      const [first, second] = added
      othersUnchanged(before.clips, after, new Set([whole.id]))
      // The halves tile the whole on the timeline...
      for (const half of [first, second]) {
        expect(half.trackId, 'a half stays on the row').toBe(whole.trackId)
        expect(half.sourceVideoId, 'a half plays the same source').toBe(whole.sourceVideoId)
      }
      expect(first.timelinePosition, 'the first half starts where the whole did').toBe(whole.timelinePosition)
      close(second.timelinePosition, first.timelinePosition + first.duration, 'the second half starts where the first ends')
      close(first.duration + second.duration, whole.duration, 'the halves add up to the whole')
      // ...and, for media, play the same source at every instant they cover.
      if (!isExtendable(whole)) {
        expect(first.startTime, 'the first half keeps the in point').toBe(whole.startTime)
        expect(second.endTime, 'the second half keeps the out point').toBe(whole.endTime)
        expect(second.startTime, 'the second half starts in the source where the first ends').toBe(first.endTime)
        close(anchor(first), anchor(whole), 'the first half plays the source where the whole did')
        close(anchor(second), anchor(whole), 'the second half plays the source where the whole did')
      }
      return
    }
    case 'move': {
      expect(added).toEqual([])
      expect(removed).toEqual([])
      const moved = before.clips.find((c) => {
        const now = after.find((a) => a.id === c.id)!
        return now.trackId !== c.trackId || now.timelinePosition !== c.timelinePosition
      })
      othersUnchanged(before.clips, after, new Set(moved ? [moved.id] : []))
      if (moved) {
        const now = after.find((a) => a.id === moved.id)!
        // A move changes where the clip sits, never what it plays.
        expect({ ...now, trackId: moved.trackId, timelinePosition: moved.timelinePosition }).toEqual(moved)
      }
      return
    }
    case 'trim': {
      expect(added).toEqual([])
      expect(removed).toEqual([])
      const target = pick(before.clips, op.clip)
      if (!target) return
      const now = after.find((c) => c.id === target.id)!
      const originalEnd = target.timelinePosition + (target.endTime - target.startTime)
      const currentEnd = now.timelinePosition + (now.endTime - now.startTime)
      const delta = currentEnd - originalEnd
      // A clip within EPS of the old end is after it too (ESCSUITE-364).
      othersUnchanged(before.clips, after, new Set([target.id]), (c) =>
        op.ripple && delta !== 0 && c.trackId === target.trackId && c.timelinePosition >= originalEnd - EPS
          ? { timelinePosition: Math.max(0, c.timelinePosition + delta) }
          : {}
      )
      if (op.edge === 'end') {
        expect(now.timelinePosition, 'an end trim never moves the start').toBe(target.timelinePosition)
        expect(now.startTime, 'an end trim never moves the source in point').toBe(target.startTime)
      } else {
        close(currentEnd, originalEnd, 'a start trim never moves the end')
        if (!isExtendable(target)) close(anchor(now), anchor(target), 'a start trim keeps the source in place under the clip')
      }
      return
    }
    case 'duplicate': {
      expect(removed).toEqual([])
      othersUnchanged(before.clips, after, new Set())
      if (added.length === 0) return
      expect(added).toHaveLength(1)
      const original = pick(before.clips, op.clip)!
      expect({ ...added[0], id: original.id, name: original.name, timelinePosition: original.timelinePosition }).toEqual(original)
      return
    }
  }
}

// ---------------------------------------------------------------------------
// The invariants, after every step.

/** A stretch of timeline and the stretch of source it plays. */
export interface MediaSpan {
  timelineStart: number
  timelineEnd: number
  sourceStart: number
  sourceEnd: number
}

/**
 * The span a clip's own picture — and the waveform the timeline draws on it —
 * covers. `AudioWaveform` reads `startTime` / `endTime`; the renderers play
 * `startTime + (t - timelinePosition)` for the clip's length on the timeline.
 */
export function pictureSpan(clip: Clip): MediaSpan {
  return {
    timelineStart: clip.timelinePosition,
    timelineEnd: clip.timelinePosition + (clip.endTime - clip.startTime),
    sourceStart: clip.startTime,
    sourceEnd: clip.endTime,
  }
}

/**
 * Every audio counterpart of `clip`, as the mixer would play it.
 *
 * On `main` there is one kind: a clip's **embedded** audio — the sound of the
 * very file the clip shows — which `core/audioMixer.ts` mixes from
 * `startTime` for `duration` seconds, starting at `timelinePosition`. A clip
 * has one when its source has audio (`hasAudio`, or an audio-only file).
 *
 * **Linked separate-track clips** (an unmerged PR) add a second kind: an audio
 * clip on another track tied to this one. When they land, append one span per
 * linked partner here (its `timelinePosition`, `+ duration`, `startTime`,
 * `endTime`); the invariant in `checkInvariants` then covers them with no
 * other change — each counterpart must cover exactly the clip's picture span.
 */
export function audioCounterparts(clip: Clip, sources: readonly SourceVideo[]): MediaSpan[] {
  const source = sources.find((s) => s.id === clip.sourceVideoId)
  if (!source || !(source.hasAudio || source.mediaType === 'audio')) return []
  return [
    {
      timelineStart: clip.timelinePosition,
      timelineEnd: clip.timelinePosition + clip.duration,
      sourceStart: clip.startTime,
      sourceEnd: clip.startTime + clip.duration,
    },
  ]
}

export function checkInvariants(): void {
  const s = state()
  const { clips, tracks, duration } = s.project.timeline
  const trackIds = new Set(tracks.map((t) => t.id))

  for (const clip of clips) {
    const tag = `clip ${clip.id} (${clip.name})`
    const source = s.sourceVideos.find((v) => v.id === clip.sourceVideoId)
    check(source !== undefined, `${tag} plays a source the library holds`)
    check(trackIds.has(clip.trackId), `${tag} sits on a track that exists`)

    // No zero or negative length, and a source range inside the media.
    for (const field of ['duration', 'startTime', 'endTime', 'timelinePosition'] as const) {
      check(Number.isFinite(clip[field]), `${tag}.${field} is finite (${clip[field]})`)
    }
    check(clip.duration > 0, `${tag} has a positive duration (${clip.duration})`)
    check(clip.timelinePosition >= 0, `${tag} starts at or after 0 (${clip.timelinePosition})`)
    check(clip.startTime >= 0, `${tag}'s in point is inside its media (${clip.startTime})`)
    check(clip.endTime > clip.startTime, `${tag}'s out point ${clip.endTime} is after its in point ${clip.startTime}`)
    close(clip.duration, clip.endTime - clip.startTime, `${tag}: duration is endTime - startTime`)
    if (isExtendableClip(clip, source)) {
      check(clip.startTime === 0, `${tag}: an extendable clip's pair is 0 / duration (startTime ${clip.startTime})`)
    } else {
      check(clip.endTime <= source!.duration + EPS, `${tag}'s out point ${clip.endTime} is inside its media (${source!.duration} s)`)
    }

    // Each audio counterpart covers exactly the clip's own picture span.
    const picture = pictureSpan(clip)
    for (const audio of audioCounterparts(clip, s.sourceVideos)) {
      close(audio.timelineStart, picture.timelineStart, `${tag}: its audio starts with it on the timeline`)
      close(audio.timelineEnd, picture.timelineEnd, `${tag}: its audio ends with it on the timeline`)
      close(audio.sourceStart, picture.sourceStart, `${tag}: its audio plays from the same source in point`)
      close(audio.sourceEnd, picture.sourceEnd, `${tag}: its audio plays to the same source out point`)
    }

    // The waveform the clip draws resolves to its own source's peaks, for its own window.
    if (source?.hasAudio && source.waveformData?.length) {
      const fixture = fixtureSource(source.id)!
      check(
        JSON.stringify(source.waveformData) === JSON.stringify(fixture.waveformData),
        `${tag}'s source still carries its own peaks`
      )
      const window = getPeaksForRange(source.waveformData, source.duration, clip.startTime, clip.endTime)
      const expected = getPeaksForRange(fixture.waveformData!, fixture.duration, clip.startTime, clip.endTime)
      check(window.length > 0, `${tag} draws a non-empty waveform`)
      check(JSON.stringify(window) === JSON.stringify(expected), `${tag} draws its own window of its own peaks`)
    }
  }

  // One row never holds two overlapping clips (timelineSnapping.ts's rule;
  // only a caption import may break it, and the model imports no captions).
  for (const a of clips) {
    for (const b of clips) {
      if (a.id >= b.id || a.trackId !== b.trackId) continue
      check(
        !overlapsSpan(b, a.timelinePosition, a.timelinePosition + a.duration),
        `clips ${a.id} [${a.timelinePosition}, ${a.timelinePosition + a.duration}) and ${b.id} [${b.timelinePosition}, ${b.timelinePosition + b.duration}) overlap on track ${a.trackId}`
      )
    }
  }

  const ends = clips.map((c) => c.timelinePosition + c.duration)
  const last = ends.length ? Math.max(...ends) : 0
  check(duration === last, `timeline.duration ${duration} is the last clip end ${last}`)
}

/**
 * Undo then redo returns the identical state (and redo then undo, when there
 * is a redo). Run after every step; it leaves the store as it found it.
 */
export function checkUndoRedoIdentity(): void {
  const s = state()
  const json = () => JSON.stringify({ project: state().project, sourceVideos: state().sourceVideos })
  const lengths = () => [state().history.past.length, state().history.future.length]
  const start = json()
  const startLengths = lengths()
  if (s.history.past.length > 0) {
    state().undo()
    state().redo()
    check(json() === start, 'undo then redo returns the identical state')
    check(lengths().join() === startLengths.join(), `undo then redo keeps the stacks' depths (${startLengths} -> ${lengths()})`)
  }
  if (state().history.future.length > 0) {
    state().redo()
    state().undo()
    check(json() === start, 'redo then undo returns the identical state')
    check(lengths().join() === startLengths.join(), `redo then undo keeps the stacks' depths (${startLengths} -> ${lengths()})`)
  }
}

/**
 * Run `ops` from a fresh editor, checking every invariant after every step.
 * A `KnownBug` is rethrown as it is, for the property test to discard.
 */
export async function runSequence(ops: readonly Op[], options: { guards?: boolean } = {}): Promise<void> {
  resetModel(options)
  for (const [i, op] of ops.entries()) {
    try {
      await applyOp(op)
      checkInvariants()
      checkUndoRedoIdentity()
    } catch (error) {
      if (error instanceof KnownBug) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw Object.assign(new Error(`step ${i} ${JSON.stringify(op)}: ${message}`), { cause: error })
    }
  }
}
