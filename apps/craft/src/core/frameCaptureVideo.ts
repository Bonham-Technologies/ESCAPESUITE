/**
 * The `<video>` a WebCodecs take draws its frames from when the browser has no
 * `MediaStreamTrackProcessor` (Firefox and Safari), without hanging the take
 * (ESCSUITE-398).
 *
 * WebKit renders a MediaStream into a `<video>` only while the element is laid
 * out on screen. One that is `visibility:hidden`, `display:none`, off-screen or
 * not in the document never gets a frame, and its `play()` never settles. The
 * recorder used to build exactly that element, `visibility:hidden`, and await
 * its `play()` with no bound, so in Safari Start left CRAFT in 'preparing' with
 * no way out. An element that is in the viewport at `opacity:0` does play, but
 * not reliably while another element (CRAFT's preview) is already rendering
 * the same track: measured in Playwright WebKit 2370, it started in about one
 * run in six. The preview itself always plays.
 *
 * So the take tries, in order:
 * 1. its own element, laid out in the viewport but transparent, for
 *    `FRAME_CAPTURE_START_TIMEOUT_MS`;
 * 2. an element already on the page that is playing this track, borrowed and
 *    never paused or removed, since it belongs to the page;
 * 3. nothing: the take fails with `FrameCaptureUnavailableError`, which the
 *    controller turns into a notice instead of a Start that never returns.
 */

/**
 * How long the take's own element gets to start. One that can play does so in
 * milliseconds; WebKit's never does, so this is what a Safari take pays before
 * it borrows the preview.
 */
export const FRAME_CAPTURE_START_TIMEOUT_MS = 2_000;

/** No element would play the video track, so there are no frames to encode. */
export class FrameCaptureUnavailableError extends Error {
  constructor() {
    super(`No video element started playing the capture within ${FRAME_CAPTURE_START_TIMEOUT_MS} ms`);
    this.name = 'FrameCaptureUnavailableError';
  }
}

export interface FrameCaptureVideo {
  element: HTMLVideoElement;
  /** True when the take built it and must take it down; false when borrowed. */
  owned: boolean;
}

/**
 * Whether `video` is playing `track` itself, with a frame to draw. CRAFT's
 * preview is handed the very stream the take records, so it holds the same
 * track object; a clone would carry a new id and is not this take's picture.
 */
function isPlaying(video: HTMLVideoElement, track: MediaStreamTrack): boolean {
  const source = video.srcObject;
  if (!(source instanceof MediaStream)) return false;
  const showsTrack = source.getVideoTracks().some((t) => t === track);
  return showsTrack && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

/** Take down an element the take built. A borrowed one is left as it is. */
export function releaseFrameCaptureVideo(capture: FrameCaptureVideo): void {
  if (!capture.owned) return;
  const { element } = capture;
  element.pause();
  element.srcObject = null;
  element.remove();
}

/**
 * A playing `<video>` showing `track`, or `FrameCaptureUnavailableError`.
 *
 * `onOwnElement` hears about the take's own element the moment it exists, so a
 * take disposed during the wait can take it down; it is not told about a
 * borrowed one, which the take must never touch.
 */
export async function openFrameCaptureVideo(
  track: MediaStreamTrack,
  width: number,
  height: number,
  onOwnElement: (capture: FrameCaptureVideo) => void = () => {}
): Promise<FrameCaptureVideo> {
  const element = document.createElement('video');
  element.srcObject = new MediaStream([track]);
  element.muted = true;
  element.playsInline = true;
  // Transparent is not hidden from assistive technology the way
  // `visibility:hidden` was, so say it outright.
  element.setAttribute('aria-hidden', 'true');
  // Laid out in the viewport, at full size so it decodes every pixel, but
  // transparent, behind the page and out of the way of the pointer. Not
  // `visibility:hidden`: WebKit never plays that.
  element.style.cssText = `position:fixed;top:0;left:0;width:${width}px;height:${height}px;opacity:0;pointer-events:none;z-index:-9999;`;
  document.body.appendChild(element);
  const own: FrameCaptureVideo = { element, owned: true };
  onOwnElement(own);

  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    giveUp = setTimeout(() => resolve('timeout'), FRAME_CAPTURE_START_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([element.play().then(() => 'playing' as const), deadline]);
    if (outcome === 'playing') return own;
  } finally {
    clearTimeout(giveUp);
  }

  releaseFrameCaptureVideo(own);
  const borrowed = Array.from(document.querySelectorAll('video')).find((video) => isPlaying(video, track));
  if (borrowed) {
    console.warn('The capture video did not start; drawing frames from the page’s own preview instead');
    return { element: borrowed, owned: false };
  }
  throw new FrameCaptureUnavailableError();
}
