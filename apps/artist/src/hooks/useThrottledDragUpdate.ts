import { useRef, useCallback, useEffect } from 'react';

/**
 * Pending update with the update function and data
 */
interface PendingUpdate<T> {
  updateFn: (data: T) => void;
  data: T;
}

/**
 * Hook for throttling state updates during drag operations.
 * Uses requestAnimationFrame to batch updates for smooth 60fps visual updates
 * while reducing the number of actual store updates.
 *
 * @returns Object with scheduleUpdate and flush functions
 *
 * @example
 * const { scheduleUpdate, flush } = useThrottledDragUpdate<Partial<Transform>>();
 *
 * // In mouse move handler:
 * scheduleUpdate(updateClipTransform.bind(null, clipId), { x: newX, y: newY });
 *
 * // In mouse up handler:
 * flush();
 */
export function useThrottledDragUpdate<T>() {
  const pendingRef = useRef<PendingUpdate<T> | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);

  // Schedule an update - will be batched with RAF
  const scheduleUpdate = useCallback((updateFn: (data: T) => void, data: T) => {
    pendingRef.current = { updateFn, data };

    if (!frameIdRef.current) {
      isActiveRef.current = true;
      frameIdRef.current = requestAnimationFrame(() => {
        frameIdRef.current = null;
        if (pendingRef.current) {
          pendingRef.current.updateFn(pendingRef.current.data);
        }
      });
    }
  }, []);

  // Immediately flush any pending update
  const flush = useCallback(() => {
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }

    if (pendingRef.current) {
      pendingRef.current.updateFn(pendingRef.current.data);
      pendingRef.current = null;
    }

    isActiveRef.current = false;
  }, []);

  // Cancel any pending update
  const cancel = useCallback(() => {
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }
    pendingRef.current = null;
    isActiveRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, []);

  return {
    scheduleUpdate,
    flush,
    cancel,
    isActive: () => isActiveRef.current,
  };
}

/**
 * Hook for managing multiple throttled update channels.
 * Useful when dragging affects multiple properties that need independent throttling.
 */
export function useMultiThrottledDragUpdate() {
  const channelsRef = useRef<Map<string, {
    pending: unknown;
    updateFn: (data: unknown) => void;
    frameId: number | null;
  }>>(new Map());

  const scheduleUpdate = useCallback(<T>(
    channel: string,
    updateFn: (data: T) => void,
    data: T
  ) => {
    let channelState = channelsRef.current.get(channel);

    if (!channelState) {
      channelState = { pending: null, updateFn: updateFn as (data: unknown) => void, frameId: null };
      channelsRef.current.set(channel, channelState);
    }

    channelState.pending = data;
    channelState.updateFn = updateFn as (data: unknown) => void;

    if (!channelState.frameId) {
      channelState.frameId = requestAnimationFrame(() => {
        const state = channelsRef.current.get(channel);
        if (state) {
          state.frameId = null;
          if (state.pending !== null) {
            state.updateFn(state.pending);
          }
        }
      });
    }
  }, []);

  const flush = useCallback((channel?: string) => {
    if (channel) {
      const state = channelsRef.current.get(channel);
      if (state) {
        if (state.frameId) {
          cancelAnimationFrame(state.frameId);
          state.frameId = null;
        }
        if (state.pending !== null) {
          state.updateFn(state.pending);
          state.pending = null;
        }
      }
    } else {
      // Flush all channels
      channelsRef.current.forEach((state) => {
        if (state.frameId) {
          cancelAnimationFrame(state.frameId);
          state.frameId = null;
        }
        if (state.pending !== null) {
          state.updateFn(state.pending);
          state.pending = null;
        }
      });
    }
  }, []);

  const cancel = useCallback((channel?: string) => {
    if (channel) {
      const state = channelsRef.current.get(channel);
      if (state) {
        if (state.frameId) {
          cancelAnimationFrame(state.frameId);
          state.frameId = null;
        }
        state.pending = null;
      }
    } else {
      // Cancel all channels
      channelsRef.current.forEach((state) => {
        if (state.frameId) {
          cancelAnimationFrame(state.frameId);
          state.frameId = null;
        }
        state.pending = null;
      });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      channelsRef.current.forEach((state) => {
        if (state.frameId) {
          cancelAnimationFrame(state.frameId);
        }
      });
    };
  }, []);

  return { scheduleUpdate, flush, cancel };
}
