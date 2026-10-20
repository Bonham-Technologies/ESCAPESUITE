<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Overlay System
- **ShapeType**: `'rectangle' | 'ellipse' | 'line' | 'arrow' | 'blur'`
- **Blur overlay**: Dedicated shape type that blurs underlying content without fill/stroke
- Blur uses offscreen canvas capture to avoid self-reference issues
- Blur rotation transforms the clip region without rotating the blurred content

#### Legacy overlay arrays
Older ARTIST versions stored overlays in `timeline.textOverlays` / `timeline.shapeOverlays`
instead of as clips. Those arrays are **input-only — write-never, read-once**: nothing in the
app creates, renders, edits or selects a legacy overlay; apart from `ensureTimelineHasTracks`
normalising a missing array to `[]` first, the only code that touches either array is
`store/legacyOverlays.ts`'s `convertLegacyOverlays(timeline)`; and the `TextOverlay` /
`ShapeOverlay` types survive in `store/types.ts` solely so an old file on disk still parses.
The conversion folds them into ordinary overlay clips and empties them. It runs on **every**
load path — both return paths of
`ensureTimelineHasTracks` (`projectMigration.ts`, so every `setProject` caller: Open Project, the
media library, session restore and the host's `LOAD_PROJECT`) and `headless/renderProject.ts`'s
`render()`, which does not go through the store. Before this, a legacy overlay drew in the
preview and was then silently missing from every export and every headless render, because the
exporters only iterate `timeline.clips`.

- **Pure and deterministic** — no store, no React, **no `uuid`**: ids derive from the legacy
  ids (`legacy-text-<id>` / `legacy-shape-<id>`), so the same file always converts to the same
  project and a headless render of it is reproducible. An entry whose derived id is already a
  clip is skipped, which makes the function idempotent and lets a half-converted file converge.
- **A window with no usable start or end is repaired first (ESCSUITE-300).** A legacy overlay's
  `startTime` / `endTime` are timeline times the conversion turns into a clip's position and
  length, and `Math.max` passes `NaN` through, so a pair that was not two finite numbers (missing,
  `null`, a string, `NaN`, `Infinity`) used to convert into a NaN-length clip that `parseProject`
  accepted and the exporter refused (`assertExportableLength`), far from the cause. `projectMigration.ts`'s
  `repairLegacyOverlayWindows` runs inside `ensureTimelineHasTracks`, before either return path's
  conversion. Two finite times whose difference overflows (`-1.7e308` / `1.7e308`) count as unusable
  too. Such an overlay starts at its `startTime` (clamped at 0, as the conversion clamps a position)
  when that alone is a finite number, else at 0, and lasts `REPAIRED_OVERLAY_DURATION`, 5 s, the length an overlay added in the editor gets
  (`overlaySlice.ts`'s `duration ?? 5`). It is repaired rather than refused, the ESCSUITE-173 / 255
  split for a shape the app once wrote, so every old file keeps loading. One `console.warn` per
  parse counts them ("Repaired the start and end times of 2 legacy overlays; each now lasts 5 s").
  Open Project parses twice (`assertProjectParses` in `loadProject`, then the hook's own
  `parseProject` on the unmigrated project), so it warns twice; the host and headless paths warn once.
  A finite pair is left to the conversion, inverted or zero-length included: it has always clamped
  that to its 0.1 s minimum, so a file that loaded before converts byte for byte as it did. A legacy
  overlay has no source, so there is no media length to take instead.
- **Identity on empty input** — with both arrays empty or absent it returns the *same*
  `Timeline` object, so a modern project (the headless kit's fixture included) is provably
  untouched.
- **Track placement is load-bearing.** The legacy preview drew all clips by ascending track
  index and then, on top of everything, all shapes followed by all text. So the conversion
  processes **shapes before texts** and puts them on tracks it creates *above every existing
  track* (`legacy-overlay-track-N`, named `Overlay`, `Overlay 2`, …), reusing one of its own
  tracks only when the windows do not overlap — and the reuse pool is **per kind**, so every
  text track is created after (and indexed above) every shape track; one shared pool would let
  a text land on a low track created for a shape while a later shape spilled above it,
  inverting the stacking. The cost is one extra track where a shape and a non-overlapping text
  could have shared one. `findEmptyTrack` — what `addTextOverlayClip`
  uses — is deliberately NOT used here: it would reuse a low-index empty track and hide the
  overlays underneath media clips, silently changing the picture of every such project.
  Converted overlays are ordinary clips, so they now take part in the normal
  clip/transition compositing order — `drawTransition` runs after the track loop — which
  differs from the old always-on-top loop only while a transition is active: a converted
  overlay is covered by a dissolve where the legacy one drew over it.
- **Degenerate data is clamped, not dropped**: `endTime <= startTime` becomes a 0.1 s clip,
  a negative `startTime` becomes position 0. A legacy `'blur'` shape drew **nothing at all**
  (the legacy loop passed no canvas, and `case 'blur'` draws neither fill nor stroke), so
  rather than convert it into an invisible clip the conversion gives it `blurAmount: 10` — the
  live default, so the inspector's slider agrees with the picture — while carrying its stored
  fill and stroke through unchanged (`addShapeOverlayClip`'s `#00000000` fill and
  `strokeWidth: 0` overrides are **not** applied, so they survive a later type change). The
  timeline `duration` is recomputed, so an overlay reaching past the stored duration extends
  the timeline (that is what gets it exported).
