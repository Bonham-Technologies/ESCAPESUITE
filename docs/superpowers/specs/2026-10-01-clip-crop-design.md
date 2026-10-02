# ESCSUITE-6 — Clip cropping (v1) — design

**Status:** approved by the operator 2026-10-01 ("all recommended"). Jira: ESCSUITE-6.
**Scope:** ESCAPEARTIST (`apps/artist`) only. v1 is inspector-driven; on-canvas crop handles are a
separate v2 ticket.

## Goal

A media clip (video or image) can show a rectangular sub-region of its source instead of the whole
frame. The cropped region is what the preview draws, what both exporters encode, what the headless
kit renders, and what the selection chrome and hit test measure.

## Non-goals (v1)

- On-canvas crop handles or a crop mode on the preview (v2 ticket).
- Animated crop. Like `mask` and `stroke`, `crop` is static and never keyframed.
- Cropping overlays (text, shapes). Media clips only.
- Thumbnail cropping on the timeline (v1 ignores crop there; documented).
- Seeding a crop from the ESCAPECRAFT handoff.

## Model

`Clip.crop?: ClipCrop` beside `mask` and `stroke` in `store/types.ts`:

```ts
/** Insets as fractions (0–1) of the SOURCE frame. `undefined` means no crop. */
export interface ClipCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
```

Rules:
- Media clips only; an overlay never carries `crop`.
- `undefined` means no crop; `{0,0,0,0}` is normalised to `undefined` by the inspector action.
- Valid when every inset is finite and ≥ 0, `left + right < 1` and `top + bottom < 1`. The
  remaining region must be at least 1 source pixel wide and tall (`validCrop(crop, w, h)`).
- Not an `AnimatableProperty`. `splitClip`, `duplicateClip`, paste and the `.veditor` round trip
  carry it unchanged through `cloneClip` / structuredClone / JSON.
- `parseProject` rejects a project whose clip carries a malformed `crop` with the ESCSUITE-102
  error shape (`code: 'INVALID_PROJECT'`), naming the clip id.

## Rendering

One pure helper, `core/clipCrop.ts`:

```ts
export function croppedSourceRect(sourceWidth: number, sourceHeight: number, crop?: ClipCrop):
  { sx: number; sy: number; sw: number; sh: number }
```

With no crop it returns the full frame. `drawWithMaskAndStroke` in `core/clipMask.ts` gains the
source rect and issues the nine-argument `drawImage(source, sx, sy, sw, sh, x, y, w, h)`; the
five-argument form disappears from that file. The DRAWN size is the cropped region × scale
(`sw * scaleX`, `sh * scaleY`), anchored on the clip's normalised centre, so cropping shrinks the
picture in place and never stretches it. Mask and stroke apply to the cropped rectangle.

Because every pipeline draws media through `drawClipToCanvas` / `drawImageToCanvasWithModifiers`,
the preview, both exporters, both transition paths and the headless bundle inherit the crop from
the one call site. `drawImage` count per frame is unchanged, so the perf ceiling files
(`drawFrame.perf.test.ts`, `exportMP4.perf.test.ts`, `exportWebM.perf.test.ts`) stay
byte-identical.

## Geometry

`components/Preview/previewGeometry.ts`'s drawn-size computation uses `croppedSourceRect` too, so
the selection box, hit test, marquee and drag seed match the picture. Unlike `mask`, crop changes
the rectangle itself, so this is not optional.

## UI

A "Crop" `CollapsibleSection` in the clip inspector beside "Mask & Stroke" (media clips only):
- Four percent inputs (left, top, right, bottom), each a slider + numeric field, 0–90 %, through the
  shared slider gesture `commit` (ESCSUITE-87) so a drag is one undo entry.
- Aspect presets: None, 1:1, 16:9, 9:16, 4:3 — compute centred insets from the source's aspect
  and the clip's current crop, applied as one undoable write.
- Reset → `crop: undefined`.
- Section-level `<fieldset disabled>` plus the lock notice on a locked track (ESCSUITE-84), and
  every control carries an accessible name (ESCSUITE-89).
- The normalisation lives in `useClipEditorActions.ts` (`handleCropChange`): clamps, rejects a
  crop that would leave < 1 px, turns an all-zero crop into `undefined`.

## Validation and persistence

- `parseProject`: shape check per clip as above.
- `.veditor` save/load: generic pass-through; a round-trip test pins it.
- `LOAD_PROJECT` from a host: covered by `parseProject`.

## Tests (red first)

- `core/clipCrop.test.ts`: full frame when undefined; insets → source rect; rejection cases.
- `core/clipMask.test.ts` / `canvasRenderer` tests: the nine-argument `drawImage` with the expected
  source rect and the drawn size shrunk in place; mask + crop together.
- `previewGeometry.test.ts` / `hitTest.test.ts`: the box and hit match the cropped size.
- `store/projectMigration.test.ts`: malformed crop rejected; valid parses.
- `store/clipSlice` tests: split, duplicate, paste carry crop.
- `components/ClipEditor/CropSection.test.tsx` + `useClipEditorActions` tests: inputs, presets,
  reset, lock, accessible names.
- `core/projectManager.test.ts`: round trip.
- Headless parity: one Chromium case in `services/headless-artist` (`*.chromium.test.ts`) renders a
  cropped clip (run by `test:e2e`, not by `test:run`).

## Docs and release

- `apps/artist/CLAUDE.md`: a "Crop" paragraph in the overlay / mask section, the v1 limits
  (thumbnail, no handles), the geometry rule.
- Root `CLAUDE.md`: one clause where media clip transforms/masks are summarised.
- Changeset: `@escapesuite/artist` **minor** ("Crop a clip from the inspector: four insets and
  aspect presets; the preview, exports and headless renders all honour it").
- Follow-up ticket to file on completion: on-canvas crop handles (v2).
