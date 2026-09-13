// Pure canvas-drawing helpers for the recorder's thumbnails: capturing a
// frame from the live preview (compositor canvas or video element) and
// building the placeholder used when every other capture path fails. Canvas
// creation and `toBlob` are the only side effects, and each is contained
// entirely within the function that needs it — no store, no React.

export const THUMBNAIL_WIDTH = 320;
export const THUMBNAIL_HEIGHT = 180;
const THUMBNAIL_TYPE = 'image/jpeg';
const THUMBNAIL_QUALITY = 0.8;

/**
 * Draw `source` (a compositor canvas or a video element) into a
 * THUMBNAIL_WIDTH x THUMBNAIL_HEIGHT canvas and encode it as a JPEG blob.
 *
 * Returns `null` synchronously when the frame could not be drawn at all — no
 * 2D context, or `drawImage` threw — so a caller can fall back to another
 * source. Otherwise returns a Promise of the `toBlob` result, which itself
 * resolves to `null` if the browser produced no blob.
 */
export function drawThumbnail(source: CanvasImageSource): Promise<Blob | null> | null {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  try {
    ctx.drawImage(source, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      THUMBNAIL_TYPE,
      THUMBNAIL_QUALITY
    );
  });
}

/** The placeholder thumbnail shown when no real frame could be captured. */
export function createPlaceholderThumbnail(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    ctx.fillStyle = '#666';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Recording', 160, 95);
  }
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), THUMBNAIL_TYPE, THUMBNAIL_QUALITY);
  });
}
