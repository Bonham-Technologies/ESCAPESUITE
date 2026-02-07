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
  currentFrames: Map<string, VideoFrame>;
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
    currentFrames: new Map(),
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

    // Track VideoFrame objects for cleanup at end of frame iteration
    if (frame instanceof VideoFrame) {
      manager.currentFrames.set(`${sourceId}:${timestamp}`, frame);
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
