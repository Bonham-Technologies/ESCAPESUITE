# ESCAPEARTIST Feature Batch — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 12 user-requested features for the ESCAPEARTIST video editor across 4 phases.

**Architecture:** Zustand store with normalized transforms (0-1), canvas-based preview rendering, WebCodecs export pipeline. All features extend existing patterns — no new frameworks or libraries needed.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Canvas API, WebCodecs

**Design Doc:** `docs/plans/2026-03-14-escapeartist-features-design.md`

---

## Phase 1 — Foundation

### Task 1: Project Resolution — Types & Store

**Files:**
- Modify: `apps/artist/src/store/types.ts:327-333` (Project interface)
- Modify: `apps/artist/src/store/types.ts:370-489` (EditorState interface)
- Modify: `apps/artist/src/store/types.ts:492-496` (ExportOptions interface)
- Modify: `apps/artist/src/store/projectStore.ts:128-147` (initial state)
- Test: `apps/artist/src/store/__tests__/projectStore.resolution.test.ts` (new)

**Step 1: Write failing tests for resolution in project state**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '../projectStore'

describe('Project Resolution', () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
  })

  it('should default to 720p resolution', () => {
    const { project } = useProjectStore.getState()
    expect(project.resolution).toEqual({ width: 1280, height: 720 })
  })

  it('should set project resolution', () => {
    useProjectStore.getState().setProjectResolution(1920, 1080)
    const { project } = useProjectStore.getState()
    expect(project.resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('should push resolution change to undo history', () => {
    useProjectStore.getState().setProjectResolution(1920, 1080)
    expect(useProjectStore.getState().canUndo()).toBe(true)
    useProjectStore.getState().undo()
    const { project } = useProjectStore.getState()
    expect(project.resolution).toEqual({ width: 1280, height: 720 })
  })

  it('should preserve resolution in session state', () => {
    useProjectStore.getState().setProjectResolution(3840, 2160)
    const snapshot = useProjectStore.getState().getSessionSnapshot()
    expect(snapshot.project.resolution).toEqual({ width: 3840, height: 2160 })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/artist && pnpm vitest run src/store/__tests__/projectStore.resolution.test.ts`
Expected: FAIL — `resolution` property doesn't exist on Project type

**Step 3: Add resolution to types**

In `src/store/types.ts`, add to the `Project` interface:
```typescript
resolution: { width: number; height: number }
```

Add resolution presets as a const:
```typescript
export const RESOLUTION_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4K': { width: 3840, height: 2160 },
} as const
```

**Step 4: Add resolution to store defaults and action**

In `src/store/projectStore.ts`:
- Add `resolution: { width: 1280, height: 720 }` to the default project in initial state
- Add `setProjectResolution` action:
```typescript
setProjectResolution: (width: number, height: number) => {
  set(state => {
    pushToHistory(state)
    return {
      project: {
        ...state.project,
        resolution: { width, height },
        modified: Date.now(),
      }
    }
  })
}
```
- Add `setProjectResolution` to the EditorState interface in types.ts

**Step 5: Run tests to verify they pass**

Run: `cd apps/artist && pnpm vitest run src/store/__tests__/projectStore.resolution.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/artist/src/store/types.ts apps/artist/src/store/projectStore.ts apps/artist/src/store/__tests__/projectStore.resolution.test.ts
git commit -m "feat(artist): add project resolution to types and store"
```

---

### Task 2: Project Resolution — Canvas & Preview

**Files:**
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx:52-53` (DEFAULT_WIDTH/HEIGHT)
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx:926` (canvas context setup)
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx:1752-1753` (canvas element)

**Step 1: Write failing test for canvas dimensions**

Create or extend preview tests to verify canvas uses project resolution.

```typescript
import { describe, it, expect } from 'vitest'
// Test that the canvas dimensions derive from project resolution
describe('PreviewPlayer resolution', () => {
  it('should use project resolution for canvas dimensions', () => {
    // Set project resolution to 1920x1080
    useProjectStore.getState().setProjectResolution(1920, 1080)
    // Render PreviewPlayer and verify canvas width/height attributes
    // This will require rendering the component
  })
})
```

Note: PreviewPlayer tests may need to be integration-style due to canvas. If unit testing canvas is impractical, test the dimension calculation logic as a pure function.

**Step 2: Run test to verify it fails**

Run: `cd apps/artist && pnpm vitest run` (run relevant test file)
Expected: FAIL — PreviewPlayer still uses hardcoded 1920x1080

**Step 3: Replace hardcoded dimensions with store values**

In `PreviewPlayer.tsx`:
- Remove or repurpose `DEFAULT_WIDTH` and `DEFAULT_HEIGHT` constants (keep as fallback only)
- Read resolution from store: `const { resolution } = useProjectStore(state => state.project)`
- Use `resolution.width` and `resolution.height` wherever `DEFAULT_WIDTH`/`DEFAULT_HEIGHT` are used
- Canvas element: `<canvas width={resolution.width} height={resolution.height} />`
- All coordinate transforms that reference canvas dimensions should use resolution values

**Step 4: Run tests and verify full test suite passes**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS (all existing tests should still pass since default is 1280x720 but transforms are normalized)

**Step 5: Commit**

```bash
git add apps/artist/src/components/Preview/PreviewPlayer.tsx
git commit -m "feat(artist): use project resolution for canvas dimensions"
```

---

### Task 3: Project Resolution — Import Mismatch Dialog

**Files:**
- Create: `apps/artist/src/components/ResolutionMismatchDialog.tsx`
- Modify: `apps/artist/src/components/VideoUploader.tsx:120-202` (handleFiles)
- Modify: `apps/artist/src/store/projectStore.ts` (addClipToTimeline scale logic)

**Step 1: Create ResolutionMismatchDialog component**

```typescript
interface ResolutionMismatchDialogProps {
  isOpen: boolean
  mediaName: string
  mediaDimensions: { width: number; height: number }
  projectDimensions: { width: number; height: number }
  onScaleToFit: () => void
  onKeepOriginal: () => void
}
```

Dialog shows:
- "This [image/video] (WxH) is [larger/smaller] than your project (WxH)."
- Two buttons: "Scale to Fit" / "Keep Original Size"

**Step 2: Wire into VideoUploader**

After processing a file, compare source dimensions to `project.resolution`:
- Calculate mismatch: `Math.abs(1 - sourceWidth / projectWidth) > 0.1 || Math.abs(1 - sourceHeight / projectHeight) > 0.1`
- If mismatch, show dialog before adding clip to timeline
- "Scale to Fit": calculate `scaleX = scaleY = Math.min(projectWidth / sourceWidth, projectHeight / sourceHeight)`
- "Keep Original Size": `scaleX = sourceWidth / projectWidth`, `scaleY = sourceHeight / projectHeight`

**Step 3: Add resolution change UI with warning**

Add resolution picker to project settings (wherever project name/settings are edited):
- Dropdown or presets: 720p, 1080p, 1440p, 4K, Custom
- On change attempt: show confirmation dialog
- "Changing resolution may affect overlay positions and scaling. This cannot be undone automatically."
- Buttons: "Cancel" / "Change Resolution"

**Step 4: Run full test suite**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/artist/src/components/ResolutionMismatchDialog.tsx apps/artist/src/components/VideoUploader.tsx
git commit -m "feat(artist): add resolution mismatch dialog and resolution change UI"
```

---

### Task 4: Project Resolution — Export Integration

**Files:**
- Modify: `apps/artist/src/core/exportWebM.ts` (use project resolution)
- Modify: `apps/artist/src/core/exportMP4.ts` (use project resolution)
- Modify: `apps/artist/src/core/exportTypes.ts` (dimension helpers)
- Modify: `apps/artist/src/components/Export/ExportDialog.tsx:148-189` (resolution options)

**Step 1: Update export to use project resolution as default**

- `exportToWebM` and `exportToMP4` should read project resolution as the default export size
- The `resolution` field in `ExportOptions` becomes an override: `'project' | '1080p' | '720p' | '480p'`
- When `'project'` (new default), use `project.resolution`
- Other presets still work as overrides

**Step 2: Update ExportDialog**

- Default resolution option changes to `'project'` showing "(1280x720)" or whatever the project is set to
- Advanced section still allows override

**Step 3: Run export-related tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/artist/src/core/exportWebM.ts apps/artist/src/core/exportMP4.ts apps/artist/src/core/exportTypes.ts apps/artist/src/components/Export/ExportDialog.tsx
git commit -m "feat(artist): use project resolution as default export size"
```

---

### Task 5: Text Newlines — Canvas Rendering

**Files:**
- Modify: `apps/artist/src/core/canvasRenderer.ts:18-79` (drawTextOverlayToCanvasAnimated)
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx` (preview text rendering)
- Test: `apps/artist/src/core/__tests__/canvasRenderer.test.ts` (new or extend)

**Step 1: Write failing test for multi-line text rendering**

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('drawTextOverlayToCanvasAnimated', () => {
  it('should split text on newlines and draw multiple lines', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      fillText: vi.fn(),
      fillRect: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      font: '',
      fillStyle: '',
      textAlign: 'center' as CanvasTextAlign,
      textBaseline: 'middle' as CanvasTextBaseline,
      globalAlpha: 1,
      filter: '',
    } as unknown as CanvasRenderingContext2D

    drawTextOverlayToCanvasAnimated(ctx, {
      text: 'Line 1\nLine 2\nLine 3',
      x: 0.5, y: 0.5,
      fontFamily: 'Arial', fontSize: 24,
      fontWeight: 'normal', fontStyle: 'normal',
      color: '#ffffff', backgroundColor: 'transparent',
      textAlign: 'center',
    }, 1920, 1080, { /* animated values */ })

    // Should call fillText 3 times, once per line
    const fillTextCalls = ctx.fillText.mock.calls
    expect(fillTextCalls.length).toBe(3)
    expect(fillTextCalls[0][0]).toBe('Line 1')
    expect(fillTextCalls[1][0]).toBe('Line 2')
    expect(fillTextCalls[2][0]).toBe('Line 3')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/artist && pnpm vitest run src/core/__tests__/canvasRenderer.test.ts`
Expected: FAIL — fillText called once with full string including `\n`

**Step 3: Implement multi-line text rendering**

In `canvasRenderer.ts`, modify `drawTextOverlayToCanvasAnimated`:

```typescript
// Split text into lines
const lines = textData.text.split('\n')
const lineHeight = textData.fontSize * 1.2
const totalHeight = lines.length * lineHeight

// Adjust background rectangle to encompass all lines
const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width))
// Draw background with maxLineWidth and totalHeight + padding

// Draw each line
lines.forEach((line, i) => {
  const lineY = y - (totalHeight / 2) + (i * lineHeight) + (lineHeight / 2)
  ctx.fillText(line, x, lineY)
})
```

Apply the same logic in `PreviewPlayer.tsx` preview text rendering.

**Step 4: Run tests to verify they pass**

Run: `cd apps/artist && pnpm vitest run src/core/__tests__/canvasRenderer.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/artist/src/core/canvasRenderer.ts apps/artist/src/components/Preview/PreviewPlayer.tsx apps/artist/src/core/__tests__/canvasRenderer.test.ts
git commit -m "feat(artist): support newlines in text overlay rendering"
```

---

## Phase 2 — Core Interactions

### Task 6: Timeline Click Pauses Playback

**Files:**
- Modify: `apps/artist/src/components/Timeline/Timeline.tsx:168-206` (ruler and track click handlers)

**Step 1: Write failing test**

```typescript
describe('Timeline click during playback', () => {
  it('should pause playback when timeline is clicked during play', () => {
    const store = useProjectStore.getState()
    store.setIsPlaying(true)
    // Simulate ruler click
    store.handleTimelineClick(5.0) // or however the handler works
    expect(useProjectStore.getState().isPlaying).toBe(false)
    expect(useProjectStore.getState().currentTime).toBe(5.0)
  })
})
```

**Step 2: Run test to verify it fails**

Expected: FAIL — clicking during playback doesn't pause

**Step 3: Implement pause on click**

In `Timeline.tsx`, in both `handleRulerClick` and `handleTrackClick`:
```typescript
const handleRulerClick = (e: React.MouseEvent) => {
  const time = calculateTimeFromClick(e)
  if (isPlaying) {
    setIsPlaying(false)
  }
  setCurrentTime(time)
}
```

**Step 4: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/artist/src/components/Timeline/Timeline.tsx
git commit -m "feat(artist): pause playback on timeline click"
```

---

### Task 7: Locked Aspect Ratio Default + Shift Modifier

**Files:**
- Modify: `apps/artist/src/store/types.ts` (ClipTransform — ensure scaleLocked defaults)
- Modify: `apps/artist/src/store/projectStore.ts` (default scaleLocked to true in clip creation)
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx:1587-1855` (resize handle logic)

**Step 1: Write failing tests**

```typescript
describe('Aspect ratio locking', () => {
  it('should default scaleLocked to true for new clips', () => {
    useProjectStore.getState().addClipToTimeline(sourceVideoId)
    const clip = useProjectStore.getState().timeline.clips[0]
    expect(clip.transform.scaleLocked).toBe(true)
  })

  it('should default scaleLocked to true for new text overlays', () => {
    useProjectStore.getState().addTextOverlayClip()
    const clips = useProjectStore.getState().timeline.clips
    const textClip = clips.find(c => c.overlayType === 'text')
    expect(textClip?.transform.scaleLocked).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Expected: FAIL — scaleLocked defaults to false

**Step 3: Change default and add Shift modifier**

- In all clip creation functions, set `scaleLocked: true` in the default transform
- In `PreviewPlayer.tsx` resize handler, check `e.shiftKey` to invert the lock:
```typescript
const effectiveLock = e.shiftKey ? !clip.transform.scaleLocked : clip.transform.scaleLocked
if (effectiveLock) {
  // Uniform scaling: use the larger delta to determine scale factor
  const aspect = startWidth / startHeight
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    newScaleY = newScaleX / aspect
  } else {
    newScaleX = newScaleY * aspect
  }
}
```

**Step 4: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/artist/src/store/types.ts apps/artist/src/store/projectStore.ts apps/artist/src/components/Preview/PreviewPlayer.tsx
git commit -m "feat(artist): default aspect ratio locked, Shift to toggle"
```

---

### Task 8: Inline Text Editing

**Files:**
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx` (double-click handler, textarea overlay)
- Create: `apps/artist/src/components/Preview/InlineTextEditor.tsx`

**Step 1: Create InlineTextEditor component**

```typescript
interface InlineTextEditorProps {
  clipId: string
  text: string
  x: number           // CSS pixel position on preview container
  y: number
  width: number
  height: number
  fontFamily: string
  fontSize: number     // CSS pixel size (scaled from canvas)
  fontWeight: string
  fontStyle: string
  color: string
  textAlign: CanvasTextAlign
  onCommit: (newText: string) => void
  onCancel: () => void
}
```

Component renders a `<textarea>` with:
- Absolute positioning matching overlay position on screen
- Font styling matching canvas rendering
- Auto-focus on mount
- `onBlur` and `onKeyDown` (Escape/Ctrl+Enter) handlers to commit

**Step 2: Wire into PreviewPlayer**

- Track `editingTextClipId` state (local, not in store)
- On `onDoubleClick` of canvas: check if click is on a text overlay
- If so, set `editingTextClipId` to that clip's ID
- Render `<InlineTextEditor>` positioned over the canvas
- While editing, suppress drag/resize handlers for that clip
- On commit: update text via `updateClipTextData(clipId, { text: newText })`, push to undo history
- On cancel: clear `editingTextClipId`

**Step 3: Calculate textarea position**

The textarea position must map from canvas coordinates to screen coordinates:
```typescript
const canvasRect = canvasRef.current.getBoundingClientRect()
const scaleX = canvasRect.width / resolution.width
const scaleY = canvasRect.height / resolution.height
const screenX = textData.x * canvasRect.width + canvasRect.left
const screenY = textData.y * canvasRect.height + canvasRect.top
const screenFontSize = textData.fontSize * scaleY
```

**Step 4: Run full test suite**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/artist/src/components/Preview/InlineTextEditor.tsx apps/artist/src/components/Preview/PreviewPlayer.tsx
git commit -m "feat(artist): inline text editing via double-click in preview"
```

---

### Task 9: Image Scaling Relative to Project Resolution

**Files:**
- Modify: `apps/artist/src/store/projectStore.ts:280-324` (addClipToTimeline)
- Modify: `apps/artist/src/components/VideoUploader.tsx:120-202` (handleFiles)
- Test: `apps/artist/src/store/__tests__/projectStore.imageScaling.test.ts` (new)

**Step 1: Write failing tests**

```typescript
describe('Image scaling relative to project resolution', () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject()
    // Default resolution is 1280x720
  })

  it('should auto-fit images larger than project resolution', () => {
    // Add a 4000x3000 image
    const sourceVideo = createMockSourceVideo({ width: 4000, height: 3000, mediaType: 'image' })
    useProjectStore.getState().addSourceVideo(sourceVideo)
    useProjectStore.getState().addClipToTimeline(sourceVideo.id)
    const clip = useProjectStore.getState().timeline.clips[0]
    // Should be scaled down to fit: min(1280/4000, 720/3000) = 0.24
    expect(clip.transform.scaleX).toBeCloseTo(0.32, 1) // 1280/4000
    expect(clip.transform.scaleY).toBeCloseTo(0.32, 1)
  })

  it('should keep native size for images smaller than project', () => {
    const sourceVideo = createMockSourceVideo({ width: 150, height: 100, mediaType: 'image' })
    useProjectStore.getState().addSourceVideo(sourceVideo)
    useProjectStore.getState().addClipToTimeline(sourceVideo.id)
    const clip = useProjectStore.getState().timeline.clips[0]
    // Native scale: 150/1280 = 0.117
    expect(clip.transform.scaleX).toBeCloseTo(0.117, 2)
  })
})
```

**Step 2: Run tests to verify they fail**

Expected: FAIL — clips default to scaleX=1, scaleY=1

**Step 3: Implement scaling logic in addClipToTimeline**

When adding a clip, check the source's dimensions against project resolution:
```typescript
const source = state.sourceVideos.find(v => v.id === sourceVideoId)
const { resolution } = state.project
let scaleX = 1, scaleY = 1

if (source && (source.mediaType === 'image' || source.mediaType === 'video')) {
  const nativeScaleX = source.width / resolution.width
  const nativeScaleY = source.height / resolution.height

  if (nativeScaleX > 1 || nativeScaleY > 1) {
    // Auto-fit: scale down to contain
    const fitScale = Math.min(resolution.width / source.width, resolution.height / source.height)
    scaleX = scaleY = fitScale
  } else {
    // Keep native size
    scaleX = nativeScaleX
    scaleY = nativeScaleY
  }
}
```

**Step 4: Add "Fit to Canvas" button in ClipEditor**

In the transform section of ClipEditor, when a clip has a source video:
```typescript
<button onClick={() => {
  const fitScale = Math.min(
    resolution.width / source.width,
    resolution.height / source.height
  )
  updateClipTransform(clipId, { scaleX: fitScale, scaleY: fitScale })
}}>Fit to Canvas</button>
```

**Step 5: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/artist/src/store/projectStore.ts apps/artist/src/components/ClipEditor.tsx apps/artist/src/store/__tests__/projectStore.imageScaling.test.ts
git commit -m "feat(artist): scale images relative to project resolution"
```

---

## Phase 3 — Selection System

### Task 10: Multi-Select — Store & Types

**Files:**
- Modify: `apps/artist/src/store/types.ts:370-489` (EditorState)
- Modify: `apps/artist/src/store/projectStore.ts` (new actions)
- Test: `apps/artist/src/store/__tests__/projectStore.multiSelect.test.ts` (new)

**Step 1: Write failing tests**

```typescript
describe('Multi-select', () => {
  let clipId1: string, clipId2: string, clipId3: string

  beforeEach(() => {
    useProjectStore.getState().resetProject()
    // Add 3 clips
    clipId1 = addTestClip()
    clipId2 = addTestClip()
    clipId3 = addTestClip()
  })

  it('should toggle clip in selection set', () => {
    useProjectStore.getState().toggleClipSelection(clipId1)
    expect(useProjectStore.getState().selectedClipIds.has(clipId1)).toBe(true)
    useProjectStore.getState().toggleClipSelection(clipId1)
    expect(useProjectStore.getState().selectedClipIds.has(clipId1)).toBe(false)
  })

  it('should select multiple clips', () => {
    useProjectStore.getState().toggleClipSelection(clipId1)
    useProjectStore.getState().toggleClipSelection(clipId2)
    expect(useProjectStore.getState().selectedClipIds.size).toBe(2)
  })

  it('should set primary selection to last toggled-on clip', () => {
    useProjectStore.getState().toggleClipSelection(clipId1)
    useProjectStore.getState().toggleClipSelection(clipId2)
    expect(useProjectStore.getState().selectedClipId).toBe(clipId2)
  })

  it('should clear multi-selection on single click', () => {
    useProjectStore.getState().toggleClipSelection(clipId1)
    useProjectStore.getState().toggleClipSelection(clipId2)
    useProjectStore.getState().setSelectedClipId(clipId3) // Single click
    expect(useProjectStore.getState().selectedClipIds.size).toBe(0)
  })

  it('should delete all selected clips', () => {
    useProjectStore.getState().toggleClipSelection(clipId1)
    useProjectStore.getState().toggleClipSelection(clipId2)
    useProjectStore.getState().deleteSelectedClips()
    const clips = useProjectStore.getState().timeline.clips
    expect(clips.find(c => c.id === clipId1)).toBeUndefined()
    expect(clips.find(c => c.id === clipId2)).toBeUndefined()
    expect(clips.find(c => c.id === clipId3)).toBeDefined()
  })

  it('should bulk move selected clips maintaining relative positions', () => {
    // Set known positions
    const initialPos1 = 0
    const initialPos2 = 5
    useProjectStore.getState().toggleClipSelection(clipId1)
    useProjectStore.getState().toggleClipSelection(clipId2)
    useProjectStore.getState().moveSelectedClips(2, 0) // +2 seconds
    const clips = useProjectStore.getState().timeline.clips
    const c1 = clips.find(c => c.id === clipId1)
    const c2 = clips.find(c => c.id === clipId2)
    expect(c1?.timelinePosition).toBe(initialPos1 + 2)
    expect(c2?.timelinePosition).toBe(initialPos2 + 2)
  })

  it('should mute and unmute selected clips tracks', () => {
    useProjectStore.getState().toggleClipSelection(clipId1)
    useProjectStore.getState().toggleClipSelection(clipId2)
    useProjectStore.getState().muteSelectedClips()
    // Verify the tracks of selected clips are muted
    const state = useProjectStore.getState()
    const clip1 = state.timeline.clips.find(c => c.id === clipId1)
    const track1 = state.timeline.tracks.find(t => t.id === clip1?.trackId)
    expect(track1?.muted).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Expected: FAIL — selectedClipIds doesn't exist

**Step 3: Add types and state**

In `types.ts` EditorState, add:
```typescript
selectedClipIds: Set<string>
toggleClipSelection: (clipId: string) => void
selectClipsInRange: (clipIds: string[]) => void
clearMultiSelection: () => void
moveSelectedClips: (deltaTime: number, deltaTrack: number) => void
deleteSelectedClips: () => void
copySelectedClips: () => void
pasteClips: () => void
muteSelectedClips: () => void
unmuteSelectedClips: () => void
```

**Step 4: Implement in projectStore.ts**

Add `selectedClipIds: new Set<string>()` to initial state.

Implement each action. Key behaviors:
- `setSelectedClipId` (existing): also clears `selectedClipIds`
- `toggleClipSelection`: adds/removes from set, updates `selectedClipId` to last added
- `deleteSelectedClips`: pushes to history, removes all clips in set
- `moveSelectedClips`: pushes to history, adjusts `timelinePosition` and optionally `trackId`
- `copySelectedClips`: stores clip data in a `clipboard` state field
- `pasteClips`: creates new clips from clipboard with offset positions

**Step 5: Run tests**

Run: `cd apps/artist && pnpm vitest run src/store/__tests__/projectStore.multiSelect.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/artist/src/store/types.ts apps/artist/src/store/projectStore.ts apps/artist/src/store/__tests__/projectStore.multiSelect.test.ts
git commit -m "feat(artist): add multi-select state and actions to store"
```

---

### Task 11: Multi-Select — UI Integration

**Files:**
- Modify: `apps/artist/src/components/Timeline/Timeline.tsx` (Ctrl+click handling)
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx` (multi-select visual)
- Modify: `apps/artist/src/App.tsx:218-407` (keyboard shortcuts: Delete, Ctrl+C, Ctrl+V)
- Modify: `apps/artist/src/components/Toolbar.tsx` (multi-select action buttons)

**Step 1: Timeline Ctrl+click**

In `Timeline.tsx` clip click handler:
```typescript
const handleClipClick = (clipId: string, e: React.MouseEvent) => {
  if (e.ctrlKey || e.metaKey) {
    toggleClipSelection(clipId)
  } else {
    setSelectedClipId(clipId) // clears multi-select
  }
}
```

**Step 2: Visual feedback for multi-selected clips**

- In Timeline: multi-selected clips get a distinct highlight (e.g., blue border, slightly different from single-selected)
- In Preview: multi-selected overlays show selection handles but no primary selection ring

**Step 3: Keyboard shortcuts**

In `App.tsx` `handleKeyDown`:
```typescript
// Delete key — check multi-select first
if (e.key === 'Delete' || e.key === 'Backspace') {
  if (selectedClipIds.size > 0) {
    deleteSelectedClips()
  } else if (selectedClipId) {
    deleteClip(selectedClipId)
  }
}

// Ctrl+C
if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
  if (selectedClipIds.size > 0) {
    copySelectedClips()
  }
  // else existing single-clip copy if any
}

// Ctrl+V
if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
  pasteClips()
}
```

**Step 4: Multi-select toolbar actions**

When `selectedClipIds.size > 1`, show a toolbar section with:
- Mute / Unmute buttons
- Delete button
- Selection count indicator: "3 clips selected"

**Step 5: Bulk drag in timeline**

When dragging a clip that's part of a multi-selection, all selected clips move together:
```typescript
const handleClipDrag = (clipId: string, deltaTime: number, deltaTrack: number) => {
  if (selectedClipIds.has(clipId) && selectedClipIds.size > 1) {
    moveSelectedClips(deltaTime, deltaTrack)
  } else {
    moveClip(clipId, deltaTime, deltaTrack)
  }
}
```

**Step 6: Run full test suite**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/artist/src/components/Timeline/Timeline.tsx apps/artist/src/components/Preview/PreviewPlayer.tsx apps/artist/src/App.tsx apps/artist/src/components/Toolbar.tsx
git commit -m "feat(artist): multi-select UI with Ctrl+click, bulk operations"
```

---

### Task 12: Marquee Selection — Preview & Timeline

**Files:**
- Create: `apps/artist/src/components/Preview/MarqueeSelection.tsx`
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx` (marquee in preview)
- Modify: `apps/artist/src/components/Timeline/Timeline.tsx` (marquee in timeline)

**Step 1: Create marquee selection component**

```typescript
interface MarqueeProps {
  startX: number
  startY: number
  currentX: number
  currentY: number
}
```

Renders a semi-transparent selection rectangle via absolute positioning.

**Step 2: Preview marquee**

In `PreviewPlayer.tsx`:
- Track `marqueeStart` state (null or {x, y})
- `onMouseDown` on empty canvas area (no overlay hit): start marquee
- `onMouseMove`: update marquee rect, highlight overlays whose bounding boxes intersect
- `onMouseUp`: calculate which overlay clips intersect the marquee rectangle
  - Convert marquee screen coords to normalized canvas coords
  - Check each overlay clip's position + scale bounds
  - If Ctrl held: add to existing selection. Otherwise: replace selection.
  - Call `selectClipsInRange(intersectingClipIds)`
- Click on empty space (no drag): `clearMultiSelection()` and `setSelectedClipId(null)`

**Step 3: Timeline marquee**

In `Timeline.tsx`:
- `onMouseDown` on empty track area: start marquee
- `onMouseMove`: draw selection rectangle
- `onMouseUp`: find clips within the time range and track range
  - Time range: convert pixel X to time
  - Track range: which tracks the rectangle spans
  - If Ctrl held: add to selection. Otherwise: replace.
  - Call `selectClipsInRange(matchingClipIds)`

**Step 4: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/artist/src/components/Preview/MarqueeSelection.tsx apps/artist/src/components/Preview/PreviewPlayer.tsx apps/artist/src/components/Timeline/Timeline.tsx
git commit -m "feat(artist): marquee selection in preview and timeline"
```

---

## Phase 4 — Export & Import

### Task 13: MP4 Export Investigation & Resilience

**Files:**
- Modify: `apps/artist/src/core/exportMP4.ts` (error handling, retry, logging)
- Modify: `apps/artist/src/components/Export/ExportDialog.tsx` (WebM fallback UI)
- Test: `apps/artist/src/core/__tests__/exportMP4.test.ts` (extend)

**Step 1: Add diagnostic logging to export**

Add structured logging at key points in `exportMP4.ts`:
```typescript
const exportLog: ExportLogEntry[] = []
const log = (phase: string, detail: string) => {
  exportLog.push({ phase, detail, timestamp: performance.now() })
}
```

Log at: frame loop start, each 10th frame, encoder queue pressure, codec selection, any error.

**Step 2: Add frame-level retry**

Wrap frame encoding in try/catch with single retry:
```typescript
try {
  videoEncoder.encode(frame, { keyFrame: isKeyframe })
} catch (err) {
  log('retry', `Frame ${i} failed, retrying: ${err}`)
  try {
    videoEncoder.encode(frame, { keyFrame: true }) // Force keyframe on retry
  } catch (retryErr) {
    log('fatal', `Frame ${i} retry failed: ${retryErr}`)
    throw new ExportError(`Export failed at frame ${i}`, { exportLog, progress: i / totalFrames })
  }
}
```

**Step 3: Add WebM fallback dialog**

On MP4 export failure, show dialog:
- "MP4 export failed. [Error details]"
- Buttons: "Try WebM Instead" / "Close"
- "Try WebM Instead" immediately starts WebM export with same settings

**Step 4: Add failure analytics**

```typescript
track('Export Failed', {
  format: 'mp4',
  errorType: error.name,
  progress: Math.round(progress * 100),
  sourceCodec: clips[0]?.codec || 'unknown',
  browserInfo: navigator.userAgent,
})
```

**Step 5: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/artist/src/core/exportMP4.ts apps/artist/src/components/Export/ExportDialog.tsx
git commit -m "feat(artist): add MP4 export resilience and WebM fallback"
```

---

### Task 14: Simplified Export UI

**Files:**
- Modify: `apps/artist/src/components/Export/ExportDialog.tsx:15-248` (full rewrite of UI)
- Modify: `apps/artist/src/core/storage.ts` (remember last export settings)

**Step 1: Redesign ExportDialog layout**

New structure:
```tsx
<ExportDialog>
  {/* Default view */}
  <PrimaryButton onClick={handleExportWebM}>
    Download WebM
  </PrimaryButton>

  {/* Disclosure */}
  <details open={hasUsedAdvanced}>
    <summary>Advanced options</summary>
    <FormatToggle> {/* WebM | MP4 (if supported) */}
    <QualitySelect> {/* Low | Medium | High */}
    <ResolutionSelect> {/* Project | 1080p | 720p | 480p */}
    <AdvancedExportButton />
  </details>

  {/* Progress view (when exporting) */}
  <ProgressBar />
  <CancelButton />
</ExportDialog>
```

**Step 2: Remember last-used settings**

```typescript
// On export with advanced options
await setSetting('lastExportSettings', { format, quality, resolution })

// On dialog open
const lastSettings = await getSetting('lastExportSettings')
const hasUsedAdvanced = lastSettings != null
```

**Step 3: Verify quality/resolution actually affect encoding**

Read through `exportWebM.ts` and `exportMP4.ts` to verify:
- Quality maps to bitrate settings
- Resolution maps to canvas/encoder dimensions
- Remove any options that are no-ops

**Step 4: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/artist/src/components/Export/ExportDialog.tsx apps/artist/src/core/storage.ts
git commit -m "feat(artist): simplified export UI with advanced disclosure"
```

---

### Task 15: Timeline Section Selection (In/Out Points)

**Files:**
- Modify: `apps/artist/src/store/types.ts` (inPoint, outPoint state)
- Modify: `apps/artist/src/store/projectStore.ts` (in/out actions)
- Modify: `apps/artist/src/components/Timeline/Timeline.tsx` (in/out markers, region highlight)
- Modify: `apps/artist/src/App.tsx:218-407` (I/O keyboard shortcuts)
- Modify: `apps/artist/src/components/Export/ExportDialog.tsx` (time range export)
- Modify: `apps/artist/src/core/exportWebM.ts` (timeRange parameter)
- Modify: `apps/artist/src/core/exportMP4.ts` (timeRange parameter)
- Test: `apps/artist/src/store/__tests__/projectStore.inOutPoints.test.ts` (new)

**Step 1: Write failing tests**

```typescript
describe('In/Out Points', () => {
  it('should set in point at current time', () => {
    useProjectStore.getState().setCurrentTime(5.0)
    useProjectStore.getState().setInPoint(5.0)
    expect(useProjectStore.getState().inPoint).toBe(5.0)
  })

  it('should set out point at current time', () => {
    useProjectStore.getState().setOutPoint(10.0)
    expect(useProjectStore.getState().outPoint).toBe(10.0)
  })

  it('should clear in/out points', () => {
    useProjectStore.getState().setInPoint(5.0)
    useProjectStore.getState().setOutPoint(10.0)
    useProjectStore.getState().clearInOutPoints()
    expect(useProjectStore.getState().inPoint).toBeNull()
    expect(useProjectStore.getState().outPoint).toBeNull()
  })

  it('should swap if in > out', () => {
    useProjectStore.getState().setInPoint(10.0)
    useProjectStore.getState().setOutPoint(5.0)
    expect(useProjectStore.getState().inPoint).toBe(5.0)
    expect(useProjectStore.getState().outPoint).toBe(10.0)
  })
})
```

**Step 2: Run tests to verify they fail**

Expected: FAIL — inPoint/outPoint don't exist

**Step 3: Add types and store**

In `types.ts`:
```typescript
inPoint: number | null
outPoint: number | null
setInPoint: (time: number) => void
setOutPoint: (time: number) => void
clearInOutPoints: () => void
```

In `projectStore.ts`:
```typescript
inPoint: null,
outPoint: null,
setInPoint: (time) => set(state => {
  const inPoint = time
  const outPoint = state.outPoint
  // Swap if needed
  if (outPoint !== null && inPoint > outPoint) {
    return { inPoint: outPoint, outPoint: inPoint }
  }
  return { inPoint }
}),
setOutPoint: (time) => set(state => {
  const outPoint = time
  const inPoint = state.inPoint
  if (inPoint !== null && outPoint < inPoint) {
    return { inPoint: outPoint, outPoint: inPoint }
  }
  return { outPoint }
}),
clearInOutPoints: () => set({ inPoint: null, outPoint: null }),
```

**Step 4: Add keyboard shortcuts**

In `App.tsx` `handleKeyDown`:
```typescript
if (e.key === 'i' && !isTyping) {
  setInPoint(currentTime)
}
if (e.key === 'o' && !isTyping) {
  setOutPoint(currentTime)
}
```

**Step 5: Add timeline visualization**

In `Timeline.tsx`:
- Render triangular markers at in/out positions on the ruler
- Draw shaded region between markers
- Make markers draggable (same pattern as playhead drag)
- Show floating toolbar near region with "Preview" and "Export" buttons

**Step 6: Add time range to export**

In export functions, add optional `timeRange` parameter:
```typescript
interface ExportOptions {
  // ...existing
  timeRange?: { start: number; end: number }
}
```

When set, frame loop runs from `timeRange.start` to `timeRange.end` instead of `0` to `duration`. Audio extraction also respects the range.

**Step 7: Loop playback within region**

When both in/out are set and loop is enabled, playback wraps from out to in instead of from end to start.

**Step 8: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 9: Commit**

```bash
git add apps/artist/src/store/types.ts apps/artist/src/store/projectStore.ts apps/artist/src/components/Timeline/Timeline.tsx apps/artist/src/App.tsx apps/artist/src/core/exportWebM.ts apps/artist/src/core/exportMP4.ts apps/artist/src/store/__tests__/projectStore.inOutPoints.test.ts
git commit -m "feat(artist): add in/out points with I/O keys, section export"
```

---

### Task 16: Project Save File Upload

**Files:**
- Modify: `apps/artist/src/components/VideoUploader.tsx:120-202` (detect .veditor files)
- Create: `apps/artist/src/components/ProjectLoadDialog.tsx` (3-button safety dialog)
- Modify: `apps/artist/src/App.tsx` (existing load project handler gets same dialog)
- Modify: `apps/artist/src/core/projectManager.ts:119-150` (loadProject integration)

**Step 1: Create ProjectLoadDialog component**

```typescript
interface ProjectLoadDialogProps {
  isOpen: boolean
  onCancel: () => void
  onSaveAndLoad: () => void
  onDiscardAndLoad: () => void
}
```

Dialog content:
- "Loading a project will replace your current work."
- Three buttons: "Cancel" / "Save & Load" / "Discard & Load"

**Step 2: Detect .veditor in VideoUploader**

In `handleFiles`:
```typescript
const handleFiles = async (files: FileList) => {
  for (const file of Array.from(files)) {
    if (file.name.endsWith('.veditor')) {
      handleProjectFileUpload(file)
      return // Don't process as media
    }
    // ...existing media processing
  }
}

const handleProjectFileUpload = async (file: File) => {
  const hasActiveProject = timeline.clips.length > 0
  if (hasActiveProject) {
    setPendingProjectFile(file)
    setShowProjectLoadDialog(true)
  } else {
    await loadAndApplyProject(file)
  }
}
```

**Step 3: Implement load actions**

```typescript
const loadAndApplyProject = async (file: File) => {
  const { project, sourceVideos } = await loadProject(file, setLoadProgress)
  resetProject()
  // Apply loaded project and source videos to store
  setProject(project)
  sourceVideos.forEach(sv => addSourceVideo(sv))
}

const handleSaveAndLoad = async () => {
  await saveProject(project, sourceVideos)
  await loadAndApplyProject(pendingProjectFile)
}

const handleDiscardAndLoad = async () => {
  await loadAndApplyProject(pendingProjectFile)
}
```

**Step 4: Apply same dialog to existing Ctrl+O load**

In `App.tsx`, the existing Ctrl+O handler should use the same 3-button dialog pattern when there's an active project.

**Step 5: Run tests**

Run: `cd apps/artist && pnpm vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/artist/src/components/VideoUploader.tsx apps/artist/src/components/ProjectLoadDialog.tsx apps/artist/src/App.tsx
git commit -m "feat(artist): upload .veditor files with save-or-discard safety dialog"
```

---

## Final Task: Integration Testing

### Task 17: E2E Tests for New Features

**Files:**
- Create: `apps/e2e/tests/escapeartist/resolution.spec.ts`
- Create: `apps/e2e/tests/escapeartist/multi-select.spec.ts`
- Create: `apps/e2e/tests/escapeartist/export-ui.spec.ts`

**Step 1: Write E2E tests covering critical paths**

Key scenarios:
- Project resolution: change resolution, verify canvas updates
- Multi-select: Ctrl+click multiple clips, delete all, undo restores all
- Export UI: verify default WebM button, open advanced, change format
- In/out points: set with keyboard, verify region appears
- Project upload: upload .veditor file, verify project loads

**Step 2: Run E2E tests**

Run: `cd apps/e2e && pnpm test:escapeartist`
Expected: PASS

**Step 3: Run full test suite**

Run from root:
```bash
pnpm test
pnpm lint
pnpm build
```
Expected: All pass

**Step 4: Commit**

```bash
git add apps/e2e/tests/escapeartist/
git commit -m "test(e2e): add tests for resolution, multi-select, export UI, in/out points"
```
