// The one place project space is carried onto an output raster.
//
// Everything that draws a frame computes in **project pixels**:
// `core/canvasRenderer` sizes a clip as its native source pixels times its
// scale and positions it as a fraction of the frame, and the two exporters'
// overlay loops place text and shapes the same way. The raster those calls land
// on is a different size in all three pipelines — the preview rasterises at the
// size it is displayed at, and an export rasterises at whatever resolution the
// dialog asked for — so something has to join the two spaces, once, in a way
// neither the renderer nor its callers can get individually wrong.
//
// That something is one `setTransform` per frame. It started life inline in
// `components/Preview/drawFrame.ts`, where it was the whole of the
// display-size-raster feature; the exporters did not have it at all, which is
// ESCSUITE-94 — every resolution but "Project" letterboxed the picture (a raster
// larger than the project) or cropped it (a smaller one). Lifting it here makes
// it one mechanism with three callers rather than a preview behaviour an export
// pipeline is expected to remember to copy.
//
// Pure arithmetic and two context calls. No allocation per frame: the scale and
// the two offsets are locals, so a 60 Hz preview loop passing through
// {@link openOutputFrame} allocates nothing at all.

/** A pixel grid — a project's resolution, or a raster's backing store. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Output pixels per project pixel: the project rect fitted inside the raster,
 * uniformly.
 *
 * `Math.min` rather than a per-axis scale, so a frame is never stretched. Where
 * the two aspect ratios match — which is every resolution preset since
 * ESCSUITE-94, because a preset's width is derived from the project's own aspect
 * — both ratios are the same number and the fit is exact. Where they genuinely
 * differ (an "Original" export whose bottom clip is not the project's shape) the
 * leftover is a black bar, which is the deliberate letterbox; see
 * {@link openOutputFrame}.
 *
 * A degenerate project (a resolution of zero, which the store never writes but
 * a hand-built headless request could) scales by 1 rather than dividing by zero.
 */
export function projectToOutputScale(project: PixelSize, output: PixelSize): number {
  if (!(project.width > 0) || !(project.height > 0)) return 1;
  return Math.min(output.width / project.width, output.height / project.height);
}

/**
 * Open a frame: clear the whole raster to black and leave `ctx` drawing in
 * project pixels. Returns the scale, which is also the `filterScale` every
 * `ctx.filter` on the frame needs (see `MediaDrawOptions.filterScale` — a CSS
 * filter's lengths are in output-bitmap pixels and the transform does not reach
 * them).
 *
 * The clear is the *whole raster* expressed in project coordinates, not the
 * project rect: where the project is letterboxed inside the output, the bars are
 * exactly the part of that rectangle the picture will not cover, so one fill
 * paints the frame and its bars together. Where the fit is exact — the preview,
 * and every export at a resolution that follows the project's aspect — the
 * rectangle *is* the project rect and this is the call it always was.
 */
export function openOutputFrame(
  ctx: CanvasRenderingContext2D,
  project: PixelSize,
  output: PixelSize
): number {
  const scale = projectToOutputScale(project, output);
  const offsetX = (output.width - project.width * scale) / 2;
  const offsetY = (output.height - project.height * scale) / 2;

  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  ctx.fillStyle = '#000000';
  // `-0 / scale` is `-0`, which is a different number from `0` to anything
  // comparing with Object.is — the assertions on these arguments included.
  ctx.fillRect(
    offsetX === 0 ? 0 : -offsetX / scale,
    offsetY === 0 ? 0 : -offsetY / scale,
    output.width / scale,
    output.height / scale
  );

  return scale;
}
