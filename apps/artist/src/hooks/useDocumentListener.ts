import { useEffect, useRef, useCallback } from 'react';

type EventHandler<K extends keyof DocumentEventMap> = (event: DocumentEventMap[K]) => void;

/**
 * Hook for adding document-level event listeners with automatic cleanup.
 * Solves common issues with event listener leaks in drag operations.
 *
 * @param eventType - The event type to listen for
 * @param handler - The event handler function
 * @param enabled - Whether the listener is active (default: true)
 * @param options - AddEventListener options
 *
 * @example
 * // Basic usage
 * useDocumentListener('mousemove', handleMouseMove);
 *
 * @example
 * // Conditional listener (for drag operations)
 * useDocumentListener('mousemove', handleDrag, isDragging);
 * useDocumentListener('mouseup', handleDragEnd, isDragging);
 */
export function useDocumentListener<K extends keyof DocumentEventMap>(
  eventType: K,
  handler: EventHandler<K>,
  enabled: boolean = true,
  options?: boolean | AddEventListenerOptions
): void {
  // Use ref to always have access to the latest handler without re-subscribing
  const handlerRef = useRef<EventHandler<K>>(handler);

  // Update handler ref when handler changes
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const eventHandler = (event: DocumentEventMap[K]) => {
      handlerRef.current(event);
    };

    document.addEventListener(eventType, eventHandler as EventListener, options);

    return () => {
      document.removeEventListener(eventType, eventHandler as EventListener, options);
    };
  }, [eventType, enabled, options]);
}

/**
 * Hook for managing multiple document event listeners for drag operations.
 * Provides a clean API for starting/stopping drag listeners.
 *
 * @example
 * const { startListening, stopListening } = useDragListeners({
 *   onMouseMove: handleDrag,
 *   onMouseUp: handleDragEnd,
 * });
 *
 * // In mousedown handler:
 * startListening();
 *
 * // In mouseup handler:
 * stopListening();
 */
export interface DragListenerHandlers {
  onMouseMove?: (event: MouseEvent) => void;
  onMouseUp?: (event: MouseEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}

export function useDragListeners(handlers: DragListenerHandlers) {
  const isListeningRef = useRef(false);
  const handlersRef = useRef(handlers);

  // Keep handlers ref updated
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const mouseMoveHandler = useCallback((event: MouseEvent) => {
    handlersRef.current.onMouseMove?.(event);
  }, []);

  const mouseUpHandler = useCallback((event: MouseEvent) => {
    handlersRef.current.onMouseUp?.(event);
  }, []);

  const keyDownHandler = useCallback((event: KeyboardEvent) => {
    handlersRef.current.onKeyDown?.(event);
  }, []);

  const startListening = useCallback(() => {
    if (isListeningRef.current) return;
    isListeningRef.current = true;

    if (handlers.onMouseMove) {
      document.addEventListener('mousemove', mouseMoveHandler);
    }
    if (handlers.onMouseUp) {
      document.addEventListener('mouseup', mouseUpHandler);
    }
    if (handlers.onKeyDown) {
      document.addEventListener('keydown', keyDownHandler);
    }
  }, [handlers.onMouseMove, handlers.onMouseUp, handlers.onKeyDown, mouseMoveHandler, mouseUpHandler, keyDownHandler]);

  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;

    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
    document.removeEventListener('keydown', keyDownHandler);
  }, [mouseMoveHandler, mouseUpHandler, keyDownHandler]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isListeningRef.current) {
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
        document.removeEventListener('keydown', keyDownHandler);
      }
    };
  }, [mouseMoveHandler, mouseUpHandler, keyDownHandler]);

  return { startListening, stopListening, isListening: isListeningRef.current };
}

/**
 * Hook for window-level event listeners with automatic cleanup.
 */
export function useWindowListener<K extends keyof WindowEventMap>(
  eventType: K,
  handler: (event: WindowEventMap[K]) => void,
  enabled: boolean = true,
  options?: boolean | AddEventListenerOptions
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const eventHandler = (event: WindowEventMap[K]) => {
      handlerRef.current(event);
    };

    window.addEventListener(eventType, eventHandler as EventListener, options);

    return () => {
      window.removeEventListener(eventType, eventHandler as EventListener, options);
    };
  }, [eventType, enabled, options]);
}
