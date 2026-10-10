/**
 * Video Decode Worker
 *
 * Handles video decoding using WebCodecs VideoDecoder in a Web Worker context.
 * This enables full-speed exports even in background browser tabs because
 * Web Workers are not subject to the same throttling as the main thread.
 *
 * Architecture:
 * 1. Receives video data as ArrayBuffer
 * 2. `mp4Demux.ts` demuxes the container with mp4box.js — every sample of the
 *    first video track, in decode order, with the edit list applied to its
 *    timestamps and the display matrix read as a rotation — and refuses, by
 *    name, anything it cannot present exactly as `<video>` would
 * 3. `decoderConfig.ts` builds the VideoDecoder configuration — H.264 only,
 *    the display rotation, the colour space `<video>` assumes — and refuses a
 *    track this browser cannot decode the way `<video>` would show it
 * 4. `frameDecoder.ts` feeds a VideoDecoder chunk by chunk and returns the
 *    frame `<video>` would show at a requested time, from a small cache
 * 5. Returns VideoFrame objects (transferable) for zero-copy performance
 *
 * A source refused here (an INIT_SOURCE that answers ERROR) is decoded by the
 * page's `<video>` path instead; `FrameSourceFactory` reports that so the
 * export says it is decoding in the page (ESCSUITE-254).
 *
 * This file is only glue between the message protocol and those modules,
 * and runs only inside a Web Worker; the e2e spec
 * `apps/e2e/tests/export/decode-worker.spec.ts` covers it.
 */

// Declare worker context for proper TypeScript typing
interface WorkerGlobalScopeExtended {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}
declare const self: WorkerGlobalScopeExtended;

import {
  type DecodeWorkerRequest,
  type DecodeWorkerResponse,
  type VideoSourceInfo,
  type DecodeWorkerConfig,
  DEFAULT_DECODE_WORKER_CONFIG,
} from './decodeWorker.types';
import { demuxVideoTrack } from './mp4Demux';
import { decoderConfigFor } from './decoderConfig';
import { FrameDecoder } from './frameDecoder';

/**
 * State for a single video source being decoded
 */
interface VideoSource {
  info: VideoSourceInfo;
  decoder: FrameDecoder<VideoFrame>;
}

// Active video sources
const sources = new Map<string, VideoSource>();

// Configuration (can be updated per-source)
const globalConfig: DecodeWorkerConfig = { ...DEFAULT_DECODE_WORKER_CONFIG };

/**
 * Post a response message to the main thread
 */
function postResponse(response: DecodeWorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(response, transfer);
  } else {
    self.postMessage(response);
  }
}

/**
 * Post an error response
 */
function postError(
  error: string,
  fatal: boolean,
  sourceId?: string,
  requestId?: number
): void {
  postResponse({
    type: 'ERROR',
    error,
    fatal,
    sourceId,
    requestId,
  });
}

/**
 * Post a progress update
 */
function postProgress(
  sourceId: string,
  phase: 'demuxing' | 'indexing' | 'ready',
  progress: number
): void {
  postResponse({
    type: 'PROGRESS',
    sourceId,
    phase,
    progress: Math.round(progress),
  });
}

/**
 * Initialize a video source from ArrayBuffer data
 */
async function initializeSource(
  sourceId: string,
  data: ArrayBuffer,
  _mimeType: string
): Promise<void> {
  try {
    postProgress(sourceId, 'demuxing', 0);

    const video = await demuxVideoTrack(data);

    postProgress(sourceId, 'indexing', 75);

    const config = await decoderConfigFor(
      video,
      (candidate) => VideoDecoder.isConfigSupported(candidate),
      globalConfig.preferHardwareAcceleration,
      navigator.userAgent
    );

    const decoder = new FrameDecoder<VideoFrame>({
      samples: video.samples,
      config,
      createDecoder: (output, error) => new VideoDecoder({ output, error }),
      createChunk: (init) => new EncodedVideoChunk(init),
      maxCachedFrames: globalConfig.maxCachedFramesPerSource,
    });

    // Width and height as shown — after the display rotation, the same
    // numbers <video>'s videoWidth/videoHeight report.
    const sourceInfo: VideoSourceInfo = {
      sourceId,
      duration: video.duration,
      width: video.displayWidth,
      height: video.displayHeight,
      codec: video.codec,
      frameCount: video.samples.length,
      keyframeCount: video.keyframeCount,
    };

    sources.set(sourceId, { info: sourceInfo, decoder });

    postProgress(sourceId, 'ready', 100);

    // Send ready response
    postResponse({
      type: 'SOURCE_READY',
      sourceId,
      info: sourceInfo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postError(message, true, sourceId);
  }
}

/**
 * Request a frame at a specific timestamp. Always answers: FRAME_READY with
 * the frame, or ERROR carrying the requestId so the caller's promise settles.
 */
async function requestFrame(
  sourceId: string,
  timestamp: number,
  requestId: number
): Promise<void> {
  const source = sources.get(sourceId);
  if (!source) {
    postError(`Source not found: ${sourceId}`, false, sourceId, requestId);
    return;
  }

  try {
    const frame = await source.decoder.getFrame(timestamp);
    postResponse(
      {
        type: 'FRAME_READY',
        requestId,
        sourceId,
        timestamp: frame.timestamp / 1_000_000,
        frame,
      },
      [frame]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postError(message, false, sourceId, requestId);
  }
}

/**
 * Release a frame (remove from cache)
 */
function releaseFrame(sourceId: string, timestamp: number): void {
  sources.get(sourceId)?.decoder.release(timestamp);
}

/**
 * Dispose of a video source and free all resources
 */
function disposeSource(sourceId: string): void {
  const source = sources.get(sourceId);
  if (!source) return;
  source.decoder.dispose();
  sources.delete(sourceId);
}

/**
 * Flush pending decode operations for a source
 */
async function flushSource(sourceId: string): Promise<void> {
  try {
    await sources.get(sourceId)?.decoder.flush();
  } catch {
    // Ignore flush errors: the next frame request reports the failure.
  }
}

/**
 * Get status of the decode worker
 */
function getStatus(): void {
  const activeSources: string[] = [];
  let cachedFrameCount = 0;
  let memoryUsage = 0;

  for (const [sourceId, source] of sources) {
    activeSources.push(sourceId);
    for (const frame of source.decoder.cachedFrames) {
      cachedFrameCount++;
      // Rough estimate: width * height * 4 bytes per pixel
      memoryUsage += frame.displayWidth * frame.displayHeight * 4;
    }
  }

  postResponse({
    type: 'STATUS',
    activeSources,
    cachedFrameCount,
    memoryUsage,
  });
}

/**
 * Handle incoming messages from main thread
 */
self.onmessage = async (event: MessageEvent<DecodeWorkerRequest>) => {
  const request = event.data;

  switch (request.type) {
    case 'INIT_SOURCE':
      await initializeSource(request.sourceId, request.data, request.mimeType);
      break;

    case 'REQUEST_FRAME':
      await requestFrame(request.sourceId, request.timestamp, request.requestId);
      break;

    case 'RELEASE_FRAME':
      releaseFrame(request.sourceId, request.timestamp);
      break;

    case 'DISPOSE_SOURCE':
      disposeSource(request.sourceId);
      break;

    case 'FLUSH':
      await flushSource(request.sourceId);
      break;

    case 'GET_STATUS':
      getStatus();
      break;

    default:
      postError(`Unknown request type: ${(request as { type: string }).type}`, false);
  }
};

// Signal that worker is ready
self.postMessage({ type: 'WORKER_READY' });
