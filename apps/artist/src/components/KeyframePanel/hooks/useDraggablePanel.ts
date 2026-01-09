import { useState, useCallback, useEffect, useRef } from 'react';

interface Position {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface DragState {
  isDragging: boolean;
  startMousePos: Position;
  startPanelPos: Position;
}

interface ResizeState {
  isResizing: boolean;
  edge: string | null;
  startMousePos: Position;
  startSize: Size;
  startPos: Position;
}

const MIN_WIDTH = 500;
const MIN_HEIGHT = 500;
const STORAGE_KEY = 'keyframePanelLayout';
const STORAGE_VERSION = 2; // Increment to reset saved dimensions

export function useDraggablePanel(
  initialPosition: Position,
  initialSize: Size,
  onPositionChange?: (position: Position) => void,
  onSizeChange?: (size: Size) => void
) {
  const [position, setPosition] = useState<Position>(() => {
    // Try to load from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Check version - reset if outdated
        if (parsed.version !== STORAGE_VERSION) {
          localStorage.removeItem(STORAGE_KEY);
          return initialPosition;
        }
        return parsed.position || initialPosition;
      }
    } catch {
      // Ignore parse errors
    }
    return initialPosition;
  });

  const [size, setSize] = useState<Size>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Check version - reset if outdated
        if (parsed.version !== STORAGE_VERSION) {
          return initialSize;
        }
        // Ensure minimum size
        const savedSize = parsed.size || initialSize;
        return {
          width: Math.max(MIN_WIDTH, savedSize.width),
          height: Math.max(MIN_HEIGHT, savedSize.height),
        };
      }
    } catch {
      // Ignore parse errors
    }
    return initialSize;
  });

  const dragState = useRef<DragState>({
    isDragging: false,
    startMousePos: { x: 0, y: 0 },
    startPanelPos: { x: 0, y: 0 },
  });

  const resizeState = useRef<ResizeState>({
    isResizing: false,
    edge: null,
    startMousePos: { x: 0, y: 0 },
    startSize: { width: 0, height: 0 },
    startPos: { x: 0, y: 0 },
  });

  // Save to localStorage when position or size changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ position, size, version: STORAGE_VERSION }));
    } catch {
      // Ignore storage errors
    }
  }, [position, size]);

  // Constrain position to viewport
  const constrainToViewport = useCallback((pos: Position, panelSize: Size): Position => {
    const maxX = window.innerWidth - panelSize.width;
    const maxY = window.innerHeight - panelSize.height;
    return {
      x: Math.max(0, Math.min(pos.x, maxX)),
      y: Math.max(0, Math.min(pos.y, maxY)),
    };
  }, []);

  // Handle drag start (title bar mouse down)
  const onTitleBarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = {
      isDragging: true,
      startMousePos: { x: e.clientX, y: e.clientY },
      startPanelPos: { ...position },
    };
  }, [position]);

  // Handle resize start
  const onResizeMouseDown = useCallback((e: React.MouseEvent, edge: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = {
      isResizing: true,
      edge,
      startMousePos: { x: e.clientX, y: e.clientY },
      startSize: { ...size },
      startPos: { ...position },
    };
  }, [size, position]);

  // Global mouse move handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Handle dragging
      if (dragState.current.isDragging) {
        const deltaX = e.clientX - dragState.current.startMousePos.x;
        const deltaY = e.clientY - dragState.current.startMousePos.y;
        const newPos = constrainToViewport(
          {
            x: dragState.current.startPanelPos.x + deltaX,
            y: dragState.current.startPanelPos.y + deltaY,
          },
          size
        );
        setPosition(newPos);
        onPositionChange?.(newPos);
      }

      // Handle resizing
      if (resizeState.current.isResizing) {
        const deltaX = e.clientX - resizeState.current.startMousePos.x;
        const deltaY = e.clientY - resizeState.current.startMousePos.y;
        const { edge, startSize, startPos } = resizeState.current;

        let newWidth = startSize.width;
        let newHeight = startSize.height;
        let newX = startPos.x;
        let newY = startPos.y;

        // Handle horizontal resize
        if (edge?.includes('e')) {
          newWidth = Math.max(MIN_WIDTH, startSize.width + deltaX);
        }
        if (edge?.includes('w')) {
          const widthDelta = Math.min(deltaX, startSize.width - MIN_WIDTH);
          newWidth = startSize.width - widthDelta;
          newX = startPos.x + widthDelta;
        }

        // Handle vertical resize
        if (edge?.includes('s')) {
          newHeight = Math.max(MIN_HEIGHT, startSize.height + deltaY);
        }
        if (edge?.includes('n')) {
          const heightDelta = Math.min(deltaY, startSize.height - MIN_HEIGHT);
          newHeight = startSize.height - heightDelta;
          newY = startPos.y + heightDelta;
        }

        const newSize = { width: newWidth, height: newHeight };
        const newPos = constrainToViewport({ x: newX, y: newY }, newSize);

        setSize(newSize);
        setPosition(newPos);
        onSizeChange?.(newSize);
        onPositionChange?.(newPos);
      }
    };

    const handleMouseUp = () => {
      dragState.current.isDragging = false;
      resizeState.current.isResizing = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [size, constrainToViewport, onPositionChange, onSizeChange]);

  // Handle window resize
  useEffect(() => {
    const handleWindowResize = () => {
      setPosition(prev => constrainToViewport(prev, size));
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [size, constrainToViewport]);

  return {
    position,
    size,
    onTitleBarMouseDown,
    onResizeMouseDown,
    setPosition,
    setSize,
  };
}
