// Waiting for a seek's frame to be presented, not only for 'seeked'
// (ESCSUITE-454).
//
// Both `<video>` export paths — `HTMLVideoFrameSource.getFrame` (the MP4
// fallback, every MP4 export in Safari) and `elementFrames.ts`'s
// `syncVideoToTime` (WebM, GIF) — seek a paused element and draw it. Chromium
// can fire 'seeked' with `seeking` false and `readyState` 4 while the frame
// `drawImage` paints is still the one from before the seek, so an export
// sometimes held the previous frame, now and then for several frames in a row:
// in CI, the untrimmed start at a trimmed clip's frame 0 (MAD 70.9) and source
// frame 7 at frame 8 (42.7), while the worker export of the same project was
// right; locally, 9 of 40 `<video>` exports under load had a stale frame.
//
// A frame callback registered before the seek fires when the sought frame is
// presented. The decode-worker parity test's own frame reader measured it
// (ESCSUITE-437): in Chromium and Firefox it fires once per completed paused
// seek, even a seek within the frame already shown, and with it 0 of 1,080
// reads were stale where 12-15 had been. So each seek an export issues
// registers one first, and once 'seeked' has fired the request waits for it,
// up to `PRESENTED_FRAME_WAIT_MS` — the same 500 ms as the wait for 'seeked'
// itself, so a request's worst case grows by one seek wait and stays well
// inside the 2 s wedge grace (`seekWedge.ts`). It is a ceiling, not a delay:
// a callback that arrives ends the wait.
//
// Where no callback comes after a paused seek, exports must not pay that
// ceiling on every frame. Whether WebKit answers one is unmeasured, and a
// hidden tab presents nothing at all. So:
// - an element without `requestVideoFrameCallback` is drawn on 'seeked', as
//   before (feature detection);
// - in a hidden document nothing is registered or waited for, and nothing
//   counts against the element;
// - an element whose landed seeks go `MISSED_PRESENTATIONS_LIMIT` times in a
//   row without a callback inside the ceiling is drawn on 'seeked' for the
//   rest of its life — today's behaviour — at a one-off cost of that many
//   ceilings. A callback that arrives starts the count again, so one slow
//   frame on a loaded machine does not turn the wait off.
// A seek that never landed ('seeked' did not fire within the request's waits)
// has no frame to wait for: its callback is cancelled and nothing is counted;
// the wedge count (`seekWedge.ts`) deals with it.

/** The longest a request waits, once 'seeked' has fired, for the sought frame's callback. */
export const PRESENTED_FRAME_WAIT_MS = 500;

/** Landed seeks in a row without a callback before an element is drawn on 'seeked' alone. */
export const MISSED_PRESENTATIONS_LIMIT = 2;

/** Consecutive landed seeks per element whose callback did not arrive within the ceiling. */
const missedPresentations = new WeakMap<HTMLVideoElement, number>();

/** A frame callback registered before a seek; see the file comment. */
export interface PresentedFrameWatch {
  /**
   * Once the request's other waits are over: when the seek landed, wait for
   * the callback, at most {@link PRESENTED_FRAME_WAIT_MS}; then cancel it if it
   * never came. Never rejects.
   */
  settle(seekLanded: boolean): Promise<void>;
}

const NOTHING_TO_WATCH: PresentedFrameWatch = { settle: () => Promise.resolve() };

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Register a frame callback on `video` for the seek the caller is about to
 * issue. Call it immediately before assigning `currentTime`, so the callback
 * cannot miss the frame, and `settle` the result after the seek's waits.
 */
export function watchPresentedFrame(video: HTMLVideoElement): PresentedFrameWatch {
  if (
    typeof video.requestVideoFrameCallback !== 'function' ||
    typeof video.cancelVideoFrameCallback !== 'function' ||
    documentHidden() ||
    (missedPresentations.get(video) ?? 0) >= MISSED_PRESENTATIONS_LIMIT
  ) {
    return NOTHING_TO_WATCH;
  }

  let presented = false;
  let wake: (() => void) | null = null;
  const handle = video.requestVideoFrameCallback(() => {
    presented = true;
    wake?.();
  });

  return {
    async settle(seekLanded: boolean): Promise<void> {
      if (seekLanded && !presented) {
        await new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, PRESENTED_FRAME_WAIT_MS);
          wake = () => {
            clearTimeout(fallback);
            resolve();
          };
        });
        wake = null;
      }
      if (presented) {
        missedPresentations.delete(video);
        return;
      }
      video.cancelVideoFrameCallback(handle);
      // A tab hidden while it waited presented nothing: not the element's miss.
      if (seekLanded && !documentHidden()) {
        missedPresentations.set(video, (missedPresentations.get(video) ?? 0) + 1);
      }
    },
  };
}
