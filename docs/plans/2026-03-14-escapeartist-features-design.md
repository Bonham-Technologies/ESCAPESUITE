# ESCAPEARTIST Feature Batch — Design Document

**Date**: 2026-03-14
**Scope**: 12 features for ESCAPEARTIST video editor (Feature #8 Bumper Layer on hold)

## Implementation Order

### Phase 1 — Foundation
1. **#3 Project Resolution** — Adds resolution to Project type, affects canvas/export/import
2. **#5 Text Newlines** — Multi-line canvas text rendering

### Phase 2 — Core Interactions
3. **#4 Timeline Click Pauses** — Pause + seek on timeline click during playback
4. **#12 Locked Aspect Ratio** — Default locked, Shift modifier to toggle
5. **#2 Inline Text Editing** — Textarea overlay on double-click in preview
6. **#11 Image Scaling** — Native pixel ratio relative to project resolution

### Phase 3 — Selection System
7. **#7 Multi-Select** — Ctrl+click, bulk move/delete/copy/paste, mute/unmute
8. **#6 Marquee Selection** — Preview + timeline drag-to-select

### Phase 4 — Export & Import
9. **#9 MP4 Export Failures** — Investigate root cause + WebM fallback on failure
10. **#13 Simplified Export UI** — Single "Download WebM" button + advanced disclosure
11. **#10 Timeline Section Select** — In/out markers with I/O keys, export selection
12. **#1 Project Save Upload** — .veditor in upload handler + 3-button safety dialog

---

## Store & Type Changes

### `src/store/types.ts`

**Project** gains a `resolution` field:
```typescript
resolution: { width: number, height: number }  // Default: 1280x720
```

**EditorState** gains multi-select and in/out points:
```typescript
selectedClipIds: Set<string>    // Full multi-select set
selectedClipId: string | null   // Primary selection (last clicked, shown in inspector)
inPoint: number | null          // Timeline section start
outPoint: number | null         // Timeline section end
```

### `src/store/projectStore.ts` — New Actions

**Resolution:**
- `setProjectResolution(width, height)` — with undo history

**Multi-select:**
- `toggleClipSelection(clipId)` — Ctrl+click: add/remove from set
- `selectClipsInRange(clipIds)` — Marquee: replace selection with set
- `clearMultiSelection()` — deselect all
- `moveSelectedClips(deltaTime, deltaTrack)` — bulk move
- `deleteSelectedClips()` — bulk delete
- `copySelectedClips()` / `pasteClips()` — bulk copy/paste
- `muteSelectedClips()` / `unmuteSelectedClips()`

**In/Out points:**
- `setInPoint(time)` / `setOutPoint(time)`
- `clearInOutPoints()`

**Selection model:** `selectedClipId` stays as "primary" selection (last clicked, shown in inspector). `selectedClipIds` is the full set. Single-click sets both. Ctrl+click toggles set membership, updates primary to last toggled-on clip.

---

## Feature Designs

### #3 — Project Resolution

**Creation & Defaults:**
- New projects default to `{ width: 1280, height: 720 }`
- Stored in `project.resolution`
- Session restore preserves resolution

**Canvas/Preview:**
- `PreviewPlayer.tsx` reads `project.resolution` instead of hardcoded 1920x1080
- Canvas element sized to project resolution, CSS-scaled to fit preview container
- Normalized transforms (0-1) continue working — they scale to whatever resolution is set

**Import Behavior:**
- Compare imported video/image dimensions to project resolution
- If mismatch (>10% difference): show dialog — "This [video/image] is [larger/smaller] than your project ([WxH]). Scale to fit?"
- Buttons: "Scale to Fit" / "Keep Original Size"
- "Scale to Fit" adjusts initial `scaleX`/`scaleY` to fit within canvas
- "Keep Original Size" sets scale based on native pixel ratio (pixels / canvas pixels)

**Resolution Change (mid-project):**
- Settings panel gets resolution picker (720p, 1080p, 1440p, 4K, custom)
- Warning dialog: "Changing resolution may affect overlay positions and scaling. This cannot be undone automatically."
- Buttons: "Cancel" / "Change Resolution"
- On confirm: update `project.resolution`, push to undo history
- Overlays keep normalized positions (0-1) — visual size changes but relative positions stay

**Export:**
- Uses project resolution by default
- Advanced options can override (upscale/downscale)

---

### #5 — Text Newlines

- Split `text` on `\n`, draw each line with `lineHeight = fontSize * 1.2`
- Total text height = `lines.length * lineHeight`
- Vertical centering adjusts based on total height
- Background rectangle grows to encompass all lines
- Update `canvasRenderer.ts` (`drawTextOverlayToCanvasAnimated`) and `PreviewPlayer.tsx` preview rendering

---

### #4 — Timeline Click Pauses Playback

- During playback, clicking anywhere in the timeline track area calls `pause()` then `seek(clickTime)`
- Clicking the ruler (which already seeks) also pauses if playing

---

### #12 — Locked Aspect Ratio

- `scaleLocked` defaults to `true` on all new clips
- Corner handles: maintain aspect ratio (scale uniformly based on diagonal drag)
- Side handles: always scale single axis regardless of lock state (standard behavior)
- Hold Shift: temporarily invert lock state (locked->unlocked, unlocked->locked)
- Per-clip: `scaleLocked` stored on each clip, toggled in inspector

---

### #2 — Inline Text Editing

- Double-click text overlay in preview -> create `<textarea>` positioned over canvas
- Styled to match: font family, size (scaled to canvas CSS size), color, alignment
- Pre-filled with current text, gets focus immediately
- Commit on blur, Escape, or Ctrl+Enter
- Push to undo history on commit
- While inline editing is active, suppress drag/resize handlers on that overlay

---

### #11 — Image Scaling Relative to Project Resolution

- On import: calculate `nativeScale = imageWidth / projectResolution.width`
- If `nativeScale > 1` (larger than canvas): auto-fit to `scaleX = scaleY = 1 / nativeScale`
- If `nativeScale <= 1`: keep native size, `scaleX = scaleY = nativeScale`
- "Fit to Canvas" button in inspector: sets scale to fit within canvas bounds (contain)
- Same logic applies to video clips based on source dimensions

---

### #7 — Multi-Track Selection and Movement

- Single click: clears multi-select, sets `selectedClipId` (current behavior)
- Ctrl+click: toggles clip in `selectedClipIds`, updates `selectedClipId` to last added
- Inspector shows primary clip properties. Shared actions (mute/unmute/delete) appear as toolbar buttons when multi-select active
- Drag any selected clip: all move together maintaining relative positions
- Delete key: deletes all selected
- Ctrl+C / Ctrl+V: copy/paste all selected (maintaining relative track/time offsets)

---

### #6 — Marquee Selection

- **Preview**: Click and drag on empty canvas area starts selection rectangle. On release, overlay clips whose bounding boxes intersect are added to `selectedClipIds`
- **Timeline**: Click and drag on empty track area starts selection rectangle. Clips within time/track range added to `selectedClipIds`
- Ctrl+drag extends existing selection (adds to set), plain drag replaces
- Clicking empty space (no drag) clears selection

---

### #9 — MP4 Export Failures

- Add detailed logging around failure points to identify codec/queue/format issues
- Try/catch around individual frame encoding — retry once before failing
- On unrecoverable failure: show dialog with clear error + "Try WebM Instead" button
- Track analytics: `Export Failed` event with format, error type, progress %, source codec

---

### #13 — Simplified Export UI

- Default: large "Download WebM" button, small "Advanced options" disclosure below
- Advanced panel (collapsed): format toggle (WebM/MP4), quality, resolution override
- MP4 only visible if `isMP4ExportSupported()` returns true
- Remember last-used advanced settings via `setSetting()` in IndexedDB
- If previously used advanced options, disclosure starts expanded next visit
- Verify quality/resolution actually affect encoding — remove any that don't

---

### #10 — Timeline Section Selection/Export

- `I` key sets in-point at playhead, `O` key sets out-point
- Rendered as draggable triangular markers on timeline ruler
- Highlighted region with subtle shading between markers
- Small floating toolbar near region: "Preview" | "Export" buttons
- "Export" opens export dialog pre-configured with time range
- Export functions get optional `timeRange: { start, end }` parameter
- Playback loops within region when both set and loop enabled
- `Escape` clears in/out points
- Filename includes range: `project-name_0m15s-1m30s.webm`

---

### #1 — Project Save File Upload

- `VideoUploader` checks file extension — `.veditor` routes to project load
- If no active project (empty timeline): load immediately
- If active project: show dialog with "Cancel" / "Save & Load" / "Discard & Load"
- "Save & Load" triggers `saveProject()` download, then loads new project on completion
- Apply same 3-button dialog to existing "Load Project" menu action

---

## On Hold

### #8 — Bumper Layer
Awaiting clarification from requestor on intended UX before designing.
