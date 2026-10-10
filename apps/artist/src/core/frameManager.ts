// Frame manager for WebCodecs-based export
// Handles frame fetching and cleanup via FrameSource abstraction

import type { DrawableMediaSource } from './exportTypes';
import {
  FrameSourceFactory,
  type FallbackCallback,
  type IFrameSource,
} from './frameSource';

/**
 * Frame manager for WebCodecs-based export
 * Handles frame fetching and cleanup
 */
export interface FrameManager {
  factory: FrameSourceFactory;
  sources: Map<string, IFrameSource>;
  // A Set, not a Map keyed by `${sourceId}:${timestamp}` (ESCSUITE-123): that
  // key is not unique — a transition's outgoing clip is fetched once as an
  // ordinary active clip and once as the transition's own outgoing side, at
  // the bit-identical source time, and the decode worker hands back a
  // distinct `frame.clone()` each time. A Map silently drops the first,
  // leaking it; nothing reads currentFrames by key, so a Set costs nothing.
  currentFrames: Set<VideoFrame>;
  useWebCodecs: boolean;
}

/**
 * Create a frame manager for WebCodecs-based export
 *
 * `signal`, when given, lets a cancelled export interrupt the decode worker's
 * startup wait instead of sitting through its full timeout (ESCSUITE-29
 * Mechanism 2) — forwarded to FrameSourceFactory.initialize().
 */
export async function createFrameManager(useWebCodecs: boolean, signal?: AbortSignal): Promise<FrameManager> {
  const factory = new FrameSourceFactory(useWebCodecs);
  await factory.initialize(signal);

  return {
    factory,
    sources: new Map(),
    currentFrames: new Set(),
    useWebCodecs: factory.isWebCodecsEnabled(),
  };
}

/**
 * Load a video source into the frame manager.
 *
 * `onFallback` is told when a source decodes on the HTMLVideoElement path while
 * the decode worker is running: an MP4 refused on load or given up on
 * mid-export, or a source that is not an MP4 at all (ESCSUITE-261).
 */
export async function loadFrameSource(
  manager: FrameManager,
  sourceId: string,
  blob: Blob,
  mimeType: string,
  onFallback?: FallbackCallback
): Promise<IFrameSource> {
  const source = await manager.factory.createSource(sourceId, blob, mimeType, undefined, onFallback);
  manager.sources.set(sourceId, source);
  return source;
}

/**
 * Get a frame from a source at the specified timestamp
 * Returns the frame without auto-cleanup - caller must manage frame lifecycle
 */
export async function getFrameAtTime(
  manager: FrameManager,
  sourceId: string,
  timestamp: number
): Promise<DrawableMediaSource | null> {
  const source = manager.sources.get(sourceId);
  if (!source) return null;

  try {
    const frame = await source.getFrame(timestamp);

    // Track VideoFrame objects for cleanup at end of frame iteration. Add
    // rather than key-and-overwrite: the same (sourceId, timestamp) can be
    // fetched more than once in a single export frame (a whole-clip
    // transition's outgoing clip is also an "active" clip), and each fetch is
    // a distinct decoded frame that owns its own close().
    if (frame instanceof VideoFrame) {
      manager.currentFrames.add(frame);
    }

    return frame;
  } catch (error) {
    console.warn(`Failed to get frame for ${sourceId} at ${timestamp}:`, error);
    return null;
  }
}

/**
 * Clean up all frames fetched during current iteration
 * Call this after drawing and encoding each frame
 */
export function cleanupIterationFrames(manager: FrameManager): void {
  for (const frame of manager.currentFrames.values()) {
    try {
      frame.close();
    } catch {
      // Frame may already be closed
    }
  }
  manager.currentFrames.clear();
}

/**
 * Clean up all frames from the frame manager
 */
function cleanupCurrentFrames(manager: FrameManager): void {
  for (const frame of manager.currentFrames.values()) {
    try {
      frame.close();
    } catch {
      // Frame may already be closed
    }
  }
  manager.currentFrames.clear();
}

/**
 * Dispose of all sources and clean up the frame manager
 */
export async function disposeFrameManager(manager: FrameManager): Promise<void> {
  cleanupCurrentFrames(manager);

  // One source failing to let go must not keep the rest, or the worker, alive
  // (ESCSUITE-254).
  for (const [sourceId, source] of manager.sources) {
    try {
      await source.dispose();
    } catch (error) {
      console.warn(`Failed to dispose frame source ${sourceId}:`, error);
    }
  }
  manager.sources.clear();

  manager.factory.dispose();
}
