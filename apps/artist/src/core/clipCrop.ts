// A media clip's crop: which rectangle of its source frame the clip shows
// (ESCSUITE-6).
//
// It sits beside `core/clipMask.ts` and for the same reason. Four unrelated
// places need the same answer — the renderer (`core/canvasRenderer.ts`, both
// media draws), the preview's geometry
// (`components/Preview/previewGeometry.ts`, so the selection box, the hit test,
// the marquee and the drag seed measure the picture that is actually drawn), the
// validator (`store/projectMigration.ts`) and the inspector's
// `handleCropChange` — and four copies of this arithmetic would be four places
// for it to drift.
//
// Pure: numbers in, numbers out. No clip, no context, no store. It allocates one
// small object per call, which in the renderer is once per media clip per frame
// — the same budget `maskPathFor` is held to.
import type { ClipCrop } from '../store/types';

/** The region of a source frame a clip draws, in source pixels. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The largest inset one edge can take, as a fraction of the source frame.
 *
 * The inspector's four sliders run 0-90%, so no single edge can crop a frame
 * away on its own. Two opposite edges still can (90% + 90%), which is what
 * {@link normaliseCrop} refuses rather than clamps: silently moving a slider the
 * user is dragging is worse than not moving it.
 */
export const MAX_CROP_INSET = 0.9;

/** What {@link normaliseCrop} decided: whether to write at all, and what. */
export interface CropDecision {
  /** `false` -> write nothing; what was asked for is not a crop. */
  ok: boolean;
  /** The crop to store. Absent *with* `ok` means "store no crop at all". */
  crop?: ClipCrop;
}

const EDGES = ['left', 'top', 'right', 'bottom'] as const;

/**
 * The region of the source that `crop` names, or the whole frame when there is
 * none.
 *
 * `sw`/`sh` are floored at one pixel. `drawImage` throws `IndexSizeError` on a
 * zero-width source rect, and in a preview frame that kills the whole frame
 * rather than one clip; neither the inspector nor a loaded project can produce
 * such a crop, but a restored session snapshot goes through neither, so the
 * floor lives here where every pipeline reads it.
 */
export function croppedSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  crop?: ClipCrop
): SourceRect {
  if (!crop) return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };

  const sx = crop.left * sourceWidth;
  const sy = crop.top * sourceHeight;
  return {
    sx,
    sy,
    sw: Math.max(1, sourceWidth - sx - crop.right * sourceWidth),
    sh: Math.max(1, sourceHeight - sy - crop.bottom * sourceHeight),
  };
}

/**
 * Is this a crop the renderer can read?
 *
 * A **shape** check and nothing more: four finite, non-negative insets that
 * leave something on each axis. It takes no source dimensions, because its one
 * caller — `parseProject` — has none: a project is validated before its media is
 * re-linked, which is the same reason it never checks a clip's `sourceVideoId`.
 * `{0,0,0,0}` passes; turning that into `undefined` is the inspector's job and a
 * file carrying one is not corrupt.
 */
export function isValidCrop(value: unknown): value is ClipCrop {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  for (const edge of EDGES) {
    const inset = candidate[edge];
    if (typeof inset !== 'number' || !Number.isFinite(inset) || inset < 0) return false;
  }

  const { left, top, right, bottom } = value as ClipCrop;
  return left + right < 1 && top + bottom < 1;
}

/** One inset, as the store is willing to hold it. */
function clampInset(inset: number): number {
  return Number.isFinite(inset) ? Math.min(Math.max(inset, 0), MAX_CROP_INSET) : 0;
}

/**
 * What the inspector should store for the crop the user asked for.
 *
 * Three outcomes, which is why this returns a {@link CropDecision} rather than a
 * `ClipCrop | undefined`: store this crop, store no crop (every inset is zero,
 * so the clip goes back to showing its whole frame), or write nothing at all
 * (what was asked for would leave less than one source pixel, which two sliders
 * at their 90% maximum genuinely ask for).
 */
export function normaliseCrop(
  crop: ClipCrop,
  sourceWidth: number,
  sourceHeight: number
): CropDecision {
  const left = clampInset(crop.left);
  const top = clampInset(crop.top);
  const right = clampInset(crop.right);
  const bottom = clampInset(crop.bottom);

  // Every inset is >= 0 after the clamp, so the sum is 0 only when all four are.
  if (left + top + right + bottom === 0) return { ok: true };

  if (
    sourceWidth - (left + right) * sourceWidth < 1 ||
    sourceHeight - (top + bottom) * sourceHeight < 1
  ) {
    return { ok: false };
  }

  return { ok: true, crop: { left, top, right, bottom } };
}

/**
 * The insets that give the clip's **current** region the aspect ratio `aspect`,
 * keeping that region's own centre.
 *
 * It narrows what is on screen rather than starting from the whole frame, which
 * is what the spec's "from the source's aspect and the clip's current crop"
 * asks for: applying 1:1 and then 16:9 crops twice, and the "None" preset is how
 * a user starts over. The result is expressed as insets of the **source**,
 * because that is what `ClipCrop` is; floating-point error can put a hair below
 * zero on an edge that should be exactly zero, which `normaliseCrop`'s clamp
 * absorbs — so every caller runs the result through it.
 */
export function cropForAspect(
  sourceWidth: number,
  sourceHeight: number,
  aspect: number,
  crop?: ClipCrop
): ClipCrop {
  const region = croppedSourceRect(sourceWidth, sourceHeight, crop);

  let width = region.sw;
  let height = region.sh;
  if (region.sw / region.sh > aspect) {
    width = region.sh * aspect;
  } else {
    height = region.sw / aspect;
  }

  const centreX = region.sx + region.sw / 2;
  const centreY = region.sy + region.sh / 2;
  return {
    left: (centreX - width / 2) / sourceWidth,
    top: (centreY - height / 2) / sourceHeight,
    right: (sourceWidth - (centreX + width / 2)) / sourceWidth,
    bottom: (sourceHeight - (centreY + height / 2)) / sourceHeight,
  };
}

/**
 * What to write for the crop a user asked for, or `null` for "write nothing".
 *
 * The one decision both crop surfaces make: the inspector's four sliders
 * (`useClipEditorActions`' `handleCropChange`) and the preview's eight handles
 * (`components/Preview/useCropHandleGesture.ts`). It was the body of the former
 * until ESCSUITE-157 needed the latter, and it is shared rather than copied for
 * the obvious reason — two normalisations would be two sets of rules about what
 * the store may hold.
 *
 * `{ crop: undefined }` is a write: the clip goes back to showing its whole
 * frame. `null` is not: a crop that would leave less than a source pixel, or
 * any crop at all on a clip with no source frame to be a fraction of, is
 * refused so the control the user is dragging snaps back to what is stored
 * rather than to a number nobody asked for.
 */
export function cropUpdateFor(
  crop: ClipCrop,
  source: { width: number; height: number } | undefined
): { crop: ClipCrop | undefined } | null {
  if (!source) {
    const empty = crop.left === 0 && crop.top === 0 && crop.right === 0 && crop.bottom === 0;
    return empty ? { crop: undefined } : null;
  }

  const decision = normaliseCrop(crop, source.width, source.height);
  if (!decision.ok) return null;
  return { crop: decision.crop };
}
