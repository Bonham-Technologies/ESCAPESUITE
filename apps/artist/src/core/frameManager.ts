// Frame manager for WebCodecs-based export
// Handles frame fetching and cleanup via FrameSource abstraction

import type { DrawableMediaSource } from './exportTypes';
import {
  FrameSourceFactory,
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
 */
export async function createFrameManager(useWebCodecs: boolean): Promise<FrameManager> {
  const factory = new FrameSourceFactory(useWebCodecs);
  await factory.initialize();

  return {
    factory,
    sources: new Map(),
    currentFrames: new Set(),
    useWebCodecs: factory.isWebCodecsEnabled(),
  };
}

/**
 * Load a video source into the frame manager
 */
export async function loadFrameSource(
  manager: FrameManager,
  sourceId: string,
  blob: Blob,
  mimeType: string
): Promise<IFrameSource> {
  const source = await manager.factory.createSource(sourceId, blob, mimeType);
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
    frame.close();
  }
  manager.currentFrames.clear();
}

/**
 * Dispose of all sources and clean up the frame manager
 */
export async function disposeFrameManager(manager: FrameManager): Promise<void> {
  cleanupCurrentFrames(manager);

  for (const source of manager.sources.values()) {
    await source.dispose();
  }
  manager.sources.clear();

  manager.factory.dispose();
}
