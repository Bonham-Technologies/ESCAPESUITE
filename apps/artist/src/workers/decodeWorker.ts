/**
 * Video Decode Worker
 *
 * Handles video decoding using WebCodecs VideoDecoder in a Web Worker context.
 * This enables full-speed exports even in background browser tabs because
 * Web Workers are not subject to the same throttling as the main thread.
 *
 * Architecture:
 * 1. Receives video data as ArrayBuffer
 * 2. Uses mp4box.js to demux the container and extract encoded chunks
 * 3. Builds a sample index for keyframe-aware seeking
 * 4. Uses VideoDecoder to decode frames on demand
 * 5. Caches decoded frames with LRU eviction
 * 6. Returns VideoFrame objects (transferable) for zero-copy performance
 */

// Declare worker context for proper TypeScript typing
interface WorkerGlobalScopeExtended {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}
declare const self: WorkerGlobalScopeExtended;

import {
  createFile,
  type MP4File,
  type MP4Info,
  type MP4Sample,
  type MP4ArrayBuffer,
  type MP4VideoTrack,
} from 'mp4box';

import {
  type DecodeWorkerRequest,
  type DecodeWorkerResponse,
  type VideoSourceInfo,
  type DecodeWorkerConfig,
  DEFAULT_DECODE_WORKER_CONFIG,
} from './decodeWorker.types';

/**
 * Represents an indexed video sample for seeking
 */
interface IndexedSample {
  number: number;
  timestamp: number; // in seconds
  duration: number; // in seconds
  offset: number;
  size: number;
  isKeyframe: boolean;
  data?: ArrayBuffer;
}

/**
 * Cached decoded frame with metadata
 */
interface CachedFrame {
  frame: VideoFrame;
  timestamp: number;
  lastAccessed: number;
}

/**
 * State for a single video source being decoded
 */
interface VideoSource {
  sourceId: string;
  info: VideoSourceInfo;
  mp4File: MP4File;
  videoTrack: MP4VideoTrack;
  decoder: VideoDecoder;
  samples: IndexedSample[];
  keyframeSamples: IndexedSample[];
  frameCache: Map<number, CachedFrame>; // keyed by sample number
  pendingRequests: Map<number, { timestamp: number; resolve: (frame: VideoFrame) => void }>;
  decodingQueue: number[]; // sample numbers being decoded
  isDecoding: boolean;
  config: DecodeWorkerConfig;
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
 * Get codec string from mp4box track description
 */
function getCodecString(track: MP4VideoTrack): string {
  // Common codec mappings
  const codecMap: Record<string, string> = {
    avc1: 'avc1.640028', // H.264 High Profile Level 4.0
    avc3: 'avc1.640028',
    hvc1: 'hvc1.1.6.L93.B0', // H.265/HEVC
    hev1: 'hvc1.1.6.L93.B0',
    vp09: 'vp09.00.10.08', // VP9
    av01: 'av01.0.04M.08', // AV1
  };

  const codecFamily = track.codec.substring(0, 4);
  return codecMap[codecFamily] || track.codec;
}

/**
 * Create VideoDecoder configuration from track info
 */
function createDecoderConfig(track: MP4VideoTrack): VideoDecoderConfig {
  return {
    codec: getCodecString(track),
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    hardwareAcceleration: globalConfig.preferHardwareAcceleration
      ? 'prefer-hardware'
      : 'prefer-software',
  };
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

    // Create mp4box file instance
    const mp4File = createFile();
    const samples: IndexedSample[] = [];

    // Promise to wait for mp4box to be ready
    const infoPromise = new Promise<MP4Info>((resolve, reject) => {
      mp4File.onError = (error: string) => {
        reject(new Error(`MP4 parsing error: ${error}`));
      };

      mp4File.onReady = (info: MP4Info) => {
        resolve(info);
      };
    });

    // Promise to collect all samples
    let samplesCollected = false;
    const samplesPromise = new Promise<void>((resolve) => {
      mp4File.onSamples = (
        _trackId: number,
        _ref: unknown,
        receivedSamples: MP4Sample[]
      ) => {
        for (const sample of receivedSamples) {
          samples.push({
            number: sample.number,
            timestamp: sample.cts / sample.timescale,
            duration: sample.duration / sample.timescale,
            offset: sample.offset,
            size: sample.size,
            isKeyframe: sample.is_sync,
            data: sample.data,
          });
        }

        // Update progress based on samples received
        if (!samplesCollected) {
          postProgress(sourceId, 'demuxing', 50);
        }
      };

      // We'll resolve this after processing is complete
      setTimeout(() => {
        samplesCollected = true;
        resolve();
      }, 100);
    });

    // Append the buffer with fileStart position
    const buffer = data as MP4ArrayBuffer;
    buffer.fileStart = 0;
    mp4File.appendBuffer(buffer);

    // Wait for info
    const info = await infoPromise;

    // Check for video tracks
    if (!info.videoTracks || info.videoTracks.length === 0) {
      throw new Error('No video tracks found in file');
    }

    const videoTrack = info.videoTracks[0];

    // Set up extraction for the video track
    mp4File.setExtractionOptions(videoTrack.id, undefined, {
      nbSamples: Infinity,
    });

    // Start extraction
    mp4File.start();

    // Wait a bit for samples to be extracted
    await samplesPromise;

    // Flush to get remaining samples
    mp4File.flush();

    // Wait a bit more for flush to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    postProgress(sourceId, 'indexing', 75);

    // Sort samples by timestamp
    samples.sort((a, b) => a.timestamp - b.timestamp);

    // Build keyframe index
    const keyframeSamples = samples.filter((s) => s.isKeyframe);

    if (keyframeSamples.length === 0) {
      throw new Error('No keyframes found in video');
    }

    // Create the VideoDecoder
    const decoderConfig = createDecoderConfig(videoTrack);

    // Check if this codec is supported
    const support = await VideoDecoder.isConfigSupported(decoderConfig);
    if (!support.supported) {
      throw new Error(`Codec not supported: ${decoderConfig.codec}`);
    }

    const frameCache = new Map<number, CachedFrame>();
    const pendingRequests = new Map<
      number,
      { timestamp: number; resolve: (frame: VideoFrame) => void }
    >();

    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        handleDecodedFrame(sourceId, frame);
      },
      error: (error: DOMException) => {
        postError(`Decoder error: ${error.message}`, true, sourceId);
      },
    });

    decoder.configure(decoderConfig);

    // Create source info
    const sourceInfo: VideoSourceInfo = {
      sourceId,
      duration: info.duration / info.timescale,
      width: videoTrack.video.width,
      height: videoTrack.video.height,
      codec: videoTrack.codec,
      frameCount: samples.length,
      keyframeCount: keyframeSamples.length,
    };

    // Store source state
    const source: VideoSource = {
      sourceId,
      info: sourceInfo,
      mp4File,
      videoTrack,
      decoder,
      samples,
      keyframeSamples,
      frameCache,
      pendingRequests,
      decodingQueue: [],
      isDecoding: false,
      config: { ...globalConfig },
    };

    sources.set(sourceId, source);

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
 * Handle a decoded frame from the VideoDecoder
 */
function handleDecodedFrame(sourceId: string, frame: VideoFrame): void {
  const source = sources.get(sourceId);
  if (!source) {
    frame.close();
    return;
  }

  // Find which sample this frame corresponds to (by timestamp)
  const frameTimestamp = frame.timestamp / 1_000_000; // Convert from microseconds
  const sampleIndex = source.samples.findIndex(
    (s) => Math.abs(s.timestamp - frameTimestamp) < 0.001
  );

  if (sampleIndex === -1) {
    // Can't match to sample, close and continue
    frame.close();
    processDecodingQueue(sourceId);
    return;
  }

  const sample = source.samples[sampleIndex];

  // Cache the frame
  const cachedFrame: CachedFrame = {
    frame,
    timestamp: sample.timestamp,
    lastAccessed: Date.now(),
  };

  source.frameCache.set(sample.number, cachedFrame);

  // Check if there's a pending request for this timestamp
  for (const [requestId, request] of source.pendingRequests.entries()) {
    if (Math.abs(request.timestamp - sample.timestamp) < 0.001) {
      // Clone the frame for the response (original stays in cache)
      const responseFrame = frame.clone();
      source.pendingRequests.delete(requestId);

      postResponse(
        {
          type: 'FRAME_READY',
          requestId,
          sourceId,
          timestamp: sample.timestamp,
          frame: responseFrame,
        },
        [responseFrame]
      );
      break;
    }
  }

  // Evict old frames if cache is full
  evictFramesIfNeeded(source);

  // Continue processing queue
  source.decodingQueue = source.decodingQueue.filter((n) => n !== sample.number);
  processDecodingQueue(sourceId);
}

/**
 * Evict old frames from cache if it exceeds the limit
 */
function evictFramesIfNeeded(source: VideoSource): void {
  while (source.frameCache.size > source.config.maxCachedFramesPerSource) {
    // Find least recently accessed frame
    let oldestKey: number | null = null;
    let oldestTime = Infinity;

    for (const [key, cached] of source.frameCache.entries()) {
      if (cached.lastAccessed < oldestTime) {
        oldestTime = cached.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      const cached = source.frameCache.get(oldestKey);
      if (cached) {
        cached.frame.close();
        source.frameCache.delete(oldestKey);
      }
    } else {
      break;
    }
  }
}

/**
 * Find the nearest keyframe at or before the given timestamp
 */
function findNearestKeyframe(
  source: VideoSource,
  timestamp: number
): IndexedSample | null {
  let nearest: IndexedSample | null = null;

  for (const keyframe of source.keyframeSamples) {
    if (keyframe.timestamp <= timestamp) {
      nearest = keyframe;
    } else {
      break;
    }
  }

  return nearest;
}

/**
 * Find the sample closest to the given timestamp
 */
function findSampleAtTimestamp(
  source: VideoSource,
  timestamp: number
): IndexedSample | null {
  let closest: IndexedSample | null = null;
  let closestDiff = Infinity;

  for (const sample of source.samples) {
    const diff = Math.abs(sample.timestamp - timestamp);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = sample;
    }
    // Early exit if we've passed the timestamp
    if (sample.timestamp > timestamp && closestDiff < 0.1) {
      break;
    }
  }

  return closest;
}

/**
 * Request a frame at a specific timestamp
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

  // Clamp timestamp to valid range
  const clampedTimestamp = Math.max(
    0,
    Math.min(timestamp, source.info.duration)
  );

  // Find the target sample
  const targetSample = findSampleAtTimestamp(source, clampedTimestamp);
  if (!targetSample) {
    postError(`No sample found for timestamp: ${timestamp}`, false, sourceId, requestId);
    return;
  }

  // Check if frame is already cached
  const cached = source.frameCache.get(targetSample.number);
  if (cached) {
    cached.lastAccessed = Date.now();
    const responseFrame = cached.frame.clone();

    postResponse(
      {
        type: 'FRAME_READY',
        requestId,
        sourceId,
        timestamp: targetSample.timestamp,
        frame: responseFrame,
      },
      [responseFrame]
    );
    return;
  }

  // Store pending request
  source.pendingRequests.set(requestId, {
    timestamp: targetSample.timestamp,
    resolve: () => {}, // Will be handled by handleDecodedFrame
  });

  // Queue samples for decoding from nearest keyframe to target
  const keyframe = findNearestKeyframe(source, clampedTimestamp);
  if (!keyframe) {
    postError('No keyframe found', false, sourceId, requestId);
    return;
  }

  // Find all samples from keyframe to target (plus look-ahead)
  const samplesToQueue: number[] = [];
  for (const sample of source.samples) {
    if (
      sample.number >= keyframe.number &&
      sample.number <= targetSample.number + source.config.lookAheadFrames
    ) {
      // Skip if already cached or queued
      if (
        !source.frameCache.has(sample.number) &&
        !source.decodingQueue.includes(sample.number)
      ) {
        samplesToQueue.push(sample.number);
      }
    }
    if (sample.number > targetSample.number + source.config.lookAheadFrames) {
      break;
    }
  }

  // Add to queue
  source.decodingQueue.push(...samplesToQueue);

  // Start processing if not already
  if (!source.isDecoding) {
    processDecodingQueue(sourceId);
  }
}

/**
 * Process the decoding queue for a source
 */
function processDecodingQueue(sourceId: string): void {
  const source = sources.get(sourceId);
  if (!source || source.decodingQueue.length === 0) {
    if (source) {
      source.isDecoding = false;
    }
    return;
  }

  source.isDecoding = true;

  // Get next sample to decode
  const sampleNumber = source.decodingQueue[0];
  const sample = source.samples.find((s) => s.number === sampleNumber);

  if (!sample || !sample.data) {
    // Skip this sample
    source.decodingQueue.shift();
    processDecodingQueue(sourceId);
    return;
  }

  try {
    // Create encoded chunk
    const chunk = new EncodedVideoChunk({
      type: sample.isKeyframe ? 'key' : 'delta',
      timestamp: sample.timestamp * 1_000_000, // Convert to microseconds
      duration: sample.duration * 1_000_000,
      data: sample.data,
    });

    // Decode it
    source.decoder.decode(chunk);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to decode sample ${sampleNumber}: ${message}`);
    source.decodingQueue.shift();
    processDecodingQueue(sourceId);
  }
}

/**
 * Release a frame (remove from cache)
 */
function releaseFrame(sourceId: string, timestamp: number): void {
  const source = sources.get(sourceId);
  if (!source) return;

  // Find sample by timestamp
  const sample = findSampleAtTimestamp(source, timestamp);
  if (!sample) return;

  const cached = source.frameCache.get(sample.number);
  if (cached) {
    cached.frame.close();
    source.frameCache.delete(sample.number);
  }
}

/**
 * Dispose of a video source and free all resources
 */
async function disposeSource(sourceId: string): Promise<void> {
  const source = sources.get(sourceId);
  if (!source) return;

  // Close all cached frames
  for (const cached of source.frameCache.values()) {
    cached.frame.close();
  }
  source.frameCache.clear();

  // Close decoder
  try {
    await source.decoder.flush();
    source.decoder.close();
  } catch {
    // Ignore errors during cleanup
  }

  // Stop mp4box
  source.mp4File.stop();

  // Remove from sources
  sources.delete(sourceId);
}

/**
 * Flush pending decode operations for a source
 */
async function flushSource(sourceId: string): Promise<void> {
  const source = sources.get(sourceId);
  if (!source) return;

  try {
    await source.decoder.flush();
  } catch {
    // Ignore flush errors
  }

  source.decodingQueue = [];
  source.isDecoding = false;
}

/**
 * Get status of the decode worker
 */
function getStatus(): void {
  const activeSources: string[] = [];
  let cachedFrameCount = 0;
  let memoryUsage = 0;

  for (const source of sources.values()) {
    activeSources.push(source.sourceId);
    cachedFrameCount += source.frameCache.size;

    // Estimate memory usage from cached frames
    for (const cached of source.frameCache.values()) {
      // Rough estimate: width * height * 4 bytes per pixel
      const frame = cached.frame;
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
      await disposeSource(request.sourceId);
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
