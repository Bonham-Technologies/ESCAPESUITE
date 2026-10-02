// GIF export (ESCSUITE-34).
//
// The third format, and the only one that needs nothing from WebCodecs: it
// shares `core/elementFrames.ts` with the WebM exporter — the media elements,
// the per-frame seek, the single track-ordered draw pass, the transitions — and
// swaps the encoder. Per frame: `openOutputFrame` and the draw pass (inside
// `composeFrame`), then one `ctx.getImageData` and one `writer.addFrame`, which
// is `quantize` -> `applyPalette` -> `writeFrame` behind `core/gifEncoder.ts`.
//
// Everything a GIF cannot carry is simply absent rather than extracted and
// discarded: there is no audio mixing, no muxer, no encoder queue and no
// backpressure wait. What is left is the frame loop, which is also what makes
// cancellation work — the abort is checked at the top of every frame, so the
// export stops within one frame of the click.
import type { Clip, SourceVideo, Track, ExportOptions } from '../store/types';
import type { MediaDrawOptions, ProgressCallback } from './exportTypes';
import { projectToOutputScale } from './outputTransform';
import {
  checkAborted,
  getResolution,
  getBaseDimensions,
  yieldToMain,
  calculateTimelineDuration,
  gifFrameRate,
  ExportError,
  type ExportLogEntry,
} from './exportTypes';
import {
  createFrameComposer,
  loadElementSources,
  releaseElementSources,
  rewindElementSources,
} from './elementFrames';
import { createGifWriter } from './gifEncoder';

/**
 * Bytes per pixel per frame, for the estimate shown **before** an export starts.
 *
 * Deliberately crude: a GIF's real size depends on how much of each frame
 * actually changes, which nothing can know in advance. It is a figure to decide
 * "is this going to be enormous" by, and it is replaced by a real one
 * (bytes-so-far / frames-done x frames-total) as soon as the first frame has
 * been written.
 */
const GIF_BYTES_PER_PIXEL_FRAME = 0.3;

/** Projected GIF size before a single frame has been encoded. */
export function estimateGifBytes(width: number, height: number, frames: number): number {
  return Math.round(width * height * frames * GIF_BYTES_PER_PIXEL_FRAME);
}

/**
 * Export the timeline — or `options.timeRange` of it, which is how "Export
 * Section" works for GIF exactly as it does for the other two — as an animated
 * GIF.
 *
 * The argument list is `exportToWebM`'s and `exportToMP4`'s, in the same order,
 * so the export dialog and the headless renderer each gained one branch rather
 * than a third calling convention.
 */
export async function exportToGIF(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  signal?: AbortSignal,
  projectResolution?: { width: number; height: number }
): Promise<Blob> {
  // No capability check: there is nothing to check. `gifenc` is pure
  // JavaScript and a 2D canvas is all this pipeline needs, which is why
  // `isGIFExportSupported()` is a constant and why this export is still
  // offered in a browser where both video formats are refused.

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Check for early abort
  checkAborted(signal);

  // The same diagnostic trail both other exporters keep, so a failure from any
  // of the three carries the same kind of log.
  const exportLog: ExportLogEntry[] = [];
  const log = (phase: string, detail: string) => {
    exportLog.push({ phase, detail, timestamp: performance.now() });
  };

  log('init', `Starting GIF export with ${clips.length} clips`);

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  const { width: baseWidth, height: baseHeight } = getBaseDimensions(clips, exportTracks, sourceVideos);
  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight, projectResolution);

  // The same door guard the other two exporters keep (ESCSUITE-152): a
  // hand-built `projectResolution` can still bypass `parseProject`, and this is
  // clearer than whatever the canvas or the quantiser would say about it.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new ExportError(
      `Cannot export at ${width}x${height}: resolved output resolution must be at least 2x2`,
      exportLog
    );
  }

  const frameRate = gifFrameRate(options.fps);
  // The GIF container stores a frame's on-screen time in centiseconds, so this
  // is rounded again on the way into the file: 100 ms and 50 ms are exact,
  // 67 ms becomes 7 cs (see `core/gifEncoder.ts`).
  const delayMs = Math.round(1000 / frameRate);

  // The space every draw call is in, as against the raster they land on — the
  // same reasoning as `exportWebM.ts`'s.
  const projectSize = projectResolution && projectResolution.width > 0 && projectResolution.height > 0
    ? { width: projectResolution.width, height: projectResolution.height }
    : { width: baseWidth, height: baseHeight };
  const outputSize = { width, height };
  const drawOptions: MediaDrawOptions = {
    filterScale: projectToOutputScale(projectSize, outputSize),
  };

  const fullDuration = calculateTimelineDuration(clips);
  const rangeStart = options.timeRange?.start ?? 0;
  const rangeEnd = options.timeRange?.end ?? fullDuration;
  const totalDuration = rangeEnd - rangeStart;
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // One canvas for the whole export. `willReadFrequently` because every frame
  // reads the whole raster back: without the hint a browser keeps the backing
  // store on the GPU and each `getImageData` is a readback stall. `alpha: false`
  // matches the other two exporters — v1 writes no transparency.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;

  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  const sources = await loadElementSources(clips, sourceMap);

  const playbackState = rewindElementSources(sources);

  const composeFrame = createFrameComposer({
    ctx,
    canvas,
    clips,
    tracks: exportTracks,
    sources,
    playbackState,
    projectSize,
    outputSize,
    drawOptions,
    frameRate,
  });

  onProgress({ phase: 'encoding', progress: 15, message: 'Encoding frames...' });
  log('frames', `Starting frame loop: ${totalFrames} total frames at ${frameRate}fps`);

  const writer = createGifWriter();
  let frameCount = 0;

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // The one place cancellation happens. There is no encoder queue to drain
      // and no muxer to finalize, so "between frames" is the whole of this
      // export's cancellation surface — and one frame is the longest a Cancel
      // click ever waits.
      checkAborted(signal);

      const currentTime = rangeStart + frameIndex / frameRate;

      await composeFrame(currentTime);

      // `getImageData` reads device pixels and ignores the current
      // transformation matrix, so this is the full output raster — including
      // any letterbox bar `openOutputFrame` painted — which is exactly what the
      // encoder should see. Nothing is saved, restored or re-transformed around
      // it, which is why the ceiling file can assert one `setTransform` a frame.
      const { data } = ctx.getImageData(0, 0, width, height);
      writer.addFrame(data, width, height, delayMs);

      frameCount++;

      if (frameCount % 5 === 0 || frameCount === totalFrames) {
        const progress = 18 + (frameCount / totalFrames) * 70;
        onProgress({
          phase: 'encoding',
          progress: Math.min(progress, 88),
          message: `Encoding frame ${frameCount}/${totalFrames}...`,
          // Bytes so far / frames done x frames total. Only ever reported from
          // inside the loop, where `frameCount` is at least one: dividing by
          // zero would put Infinity on screen.
          estimatedBytes: Math.round((writer.bytesWritten() / frameCount) * totalFrames),
        });

        // Yield to prevent UI blocking (MessageChannel, so a background tab
        // does not throttle it).
        await yieldToMain();
      }
    }

    log('frames', `Frame loop complete: ${frameCount} frames encoded`);

    onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing GIF...' });

    const bytes = writer.finish();

    // A cancel that landed while we were finishing still counts: never hand
    // back an export the caller asked to stop.
    checkAborted(signal);

    releaseElementSources(sources);

    onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

    return new Blob([bytes], { type: 'image/gif' });
  } catch (error) {
    releaseElementSources(sources);

    // Re-throw ExportAbortedError and ExportError as-is
    if (error instanceof ExportError || (error instanceof Error && error.name === 'ExportAbortedError')) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    log('error', `Export failed: ${message}`);
    throw new ExportError(message, exportLog, frameCount, totalFrames);
  }
}
