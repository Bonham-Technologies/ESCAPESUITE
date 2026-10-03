// Generate thumbnails from recorded video blobs

import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, THUMBNAIL_QUALITY, THUMBNAIL_TYPE } from '../utils/previewThumbnail';

/**
 * How long either probe in this module waits for a `<video>` to say something
 * before it gives up (ESCSUITE-180).
 *
 * The same shape as `CAPTURE_TIMEOUT_MS` in `useRecordingController.ts` and
 * for the same reason — nothing here can be aborted, so a clock is the only
 * way out — but far shorter, because nothing is waiting on a *person*: a
 * decode either starts within a second or two or it is not going to. Both
 * probes run on the save path, and since ESCSUITE-174 `'saving'` has no
 * user-reachable exit at all (Record disabled, Cancel not rendered, Escape
 * inert), so a probe that never settles parks the app for the life of the tab.
 * `extractVideoMetadata` has waited 5 s since it was written; naming the
 * number here is what lets `generateThumbnail` share it rather than carry a
 * second one.
 *
 * It is deliberately NOT a deadline on the whole save: the two IndexedDB
 * writes that follow have no safe abandon point — giving up partway through
 * `storeVideo` would leave a take half in the library — so the deadline stops
 * at the last thing on that path that can be dropped harmlessly.
 */
export const THUMBNAIL_TIMEOUT_MS = 5_000;

/**
 * Generate a thumbnail from a video blob.
 * Captures the first available frame (WebM from MediaRecorder often can't seek).
 *
 * Rejects if the element has not produced a frame within
 * `THUMBNAIL_TIMEOUT_MS`. The caller's fallback is the same one a failed
 * decode already takes — `useRecordingSave` lands on the placeholder — so the
 * save proceeds with no decoded frame rather than waiting for one that is not
 * coming.
 */
export async function generateThumbnail(videoBlob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get 2D context'));
      return;
    }

    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = THUMBNAIL_HEIGHT;

    const blobUrl = URL.createObjectURL(videoBlob);
    video.src = blobUrl;
    video.muted = true;
    video.preload = 'metadata';

    // The frame request `onloadeddata` queues, so cleanup can call it off. A
    // handle of 0 is never issued by `requestAnimationFrame`, and cancelling
    // it is a no-op — so this needs no guard, and the deadline cannot be
    // followed by a captureFrame() that cleans up a second time.
    let frameHandle = 0;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out loading video for thumbnail'));
    }, THUMBNAIL_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frameHandle);
      // Detach BEFORE emptying src. Chromium answers an empty `src` with an
      // `error` event at the element, so a handler still attached here calls
      // cleanup() again, which empties src again — an error loop that never
      // ends and that outlives the thumbnail it was cleaning up after
      // (ESCSUITE-55).
      video.onloadeddata = null;
      video.onerror = null;
      URL.revokeObjectURL(blobUrl);
      // `removeAttribute` + `load()`, not `src = ''`: emptying src is a load
      // *failure*, so it manufactures a MEDIA_ERR_SRC_NOT_SUPPORTED and fires
      // `error` at the element. `removeAttribute` does not itself invoke the
      // load algorithm, and the `load()` that follows finds neither src nor
      // srcObject, so resource selection ends at NETWORK_EMPTY with no `error`
      // and no MediaError — only `abort` and `emptied`, which nothing here
      // listens for.
      video.removeAttribute('src');
      video.load();
    };

    const captureFrame = () => {
      try {
        ctx.drawImage(video, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
        canvas.toBlob(
          (blob) => {
            cleanup();
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create thumbnail blob'));
            }
          },
          THUMBNAIL_TYPE,
          THUMBNAIL_QUALITY
        );
      } catch {
        cleanup();
        reject(new Error('Failed to draw video frame'));
      }
    };

    // Use loadeddata instead of loadedmetadata for better compatibility
    video.onloadeddata = () => {
      // Give the video a moment to render the first frame
      frameHandle = requestAnimationFrame(() => {
        captureFrame();
      });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video for thumbnail'));
    };

    // Start loading
    video.load();
  });
}

/**
 * Extract video metadata from a blob.
 * Note: WebM from MediaRecorder often has Infinity duration - pass known duration if available.
 * This function is designed to never reject - it returns sensible defaults on failure.
 */
export async function extractVideoMetadata(
  videoBlob: Blob,
  knownDuration?: number
): Promise<{ duration: number; width: number; height: number }> {
  const defaults = {
    duration: knownDuration || 0,
    width: 1920,
    height: 1080,
  };

  return new Promise((resolve) => {
    // Set a timeout in case the video never loads. The same number
    // `generateThumbnail` now waits — one deadline for the save path's two
    // probes (ESCSUITE-180).
    const timeout = setTimeout(() => {
      cleanup();
      resolve(defaults);
    }, THUMBNAIL_TIMEOUT_MS);

    const video = document.createElement('video');
    const blobUrl = URL.createObjectURL(videoBlob);
    video.src = blobUrl;
    video.muted = true;
    video.preload = 'metadata';

    const cleanup = () => {
      clearTimeout(timeout);
      // Detach BEFORE emptying src, for the reason given on generateThumbnail's
      // cleanup above. This is the copy that bit: saving a recording calls this
      // function exactly once, so from the second take of a session onward the
      // page spun in `onerror` at roughly 44,500 iterations a second, for the
      // rest of the session (ESCSUITE-55).
      video.onloadeddata = null;
      video.onerror = null;
      URL.revokeObjectURL(blobUrl);
      // `removeAttribute` + `load()`, not `src = ''`: emptying src is a load
      // *failure*, so it manufactures a MEDIA_ERR_SRC_NOT_SUPPORTED and fires
      // `error` at the element. `removeAttribute` does not itself invoke the
      // load algorithm, and the `load()` that follows finds neither src nor
      // srcObject, so resource selection ends at NETWORK_EMPTY with no `error`
      // and no MediaError — only `abort` and `emptied`, which nothing here
      // listens for.
      video.removeAttribute('src');
      video.load();
    };

    video.onloadeddata = () => {
      // WebM from MediaRecorder often has Infinity or 0 duration
      let duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        duration = knownDuration || 0;
      }

      const result = {
        duration,
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
      };

      cleanup();
      resolve(result);
    };

    video.onerror = () => {
      cleanup();
      resolve(defaults);
    };

    // Start loading
    video.load();
  });
}
