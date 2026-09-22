// Generate thumbnails from recorded video blobs

import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, THUMBNAIL_QUALITY, THUMBNAIL_TYPE } from '../utils/previewThumbnail';

/**
 * Generate a thumbnail from a video blob.
 * Captures the first available frame (WebM from MediaRecorder often can't seek).
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

    const cleanup = () => {
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
      requestAnimationFrame(() => {
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
 * Generate a thumbnail from a MediaStream (live preview).
 */
export function generateStreamThumbnail(stream: MediaStream): Promise<Blob> {
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

    video.srcObject = stream;
    video.muted = true;

    video.onloadeddata = () => {
      // Wait a moment for the video to stabilize
      setTimeout(() => {
        ctx.drawImage(video, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

        canvas.toBlob(
          (blob) => {
            video.srcObject = null;

            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create thumbnail blob'));
            }
          },
          THUMBNAIL_TYPE,
          THUMBNAIL_QUALITY
        );
      }, 100);

      video.play();
    };

    video.onerror = () => {
      video.srcObject = null;
      reject(new Error('Failed to load stream for thumbnail'));
    };
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
    // Set a timeout in case the video never loads
    const timeout = setTimeout(() => {
      cleanup();
      resolve(defaults);
    }, 5000);

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
