// Whether the inspector starts collapsed, and who decides it after that
// (ESCSUITE-345, see docs/reference/responsive-inspector.md).
//
// Below the 900px breakpoint the inspector is a fixed slide-out panel that
// covers the preview, the media library and most of the timeline, so there it
// starts shut; at wider viewports it starts expanded. Until the user toggles
// it, it follows the breakpoint as the window is resized. Their first toggle
// takes over from then on, until a reload: a resize never undoes it.
import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * The viewport at which `App.module.css` turns the inspector into a slide-out
 * panel. Keep it in step with the stylesheet's `@media (max-width: 900px)`.
 */
export const INSPECTOR_OVERLAY_QUERY = '(max-width: 900px)';

const noop = () => {};

/** The breakpoint's media query list, or `null` where there is no `matchMedia`. */
function overlayQueryList(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(INSPECTOR_OVERLAY_QUERY) : null;
}

export interface InspectorCollapsedState {
  /** Whether the inspector is collapsed now. */
  collapsed: boolean;
  /** Flip it, recording an explicit choice that later resizes leave alone. */
  toggle: () => void;
}

export function useInspectorCollapsed(): InspectorCollapsedState {
  const [queryList] = useState(overlayQueryList);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!queryList) return noop;
      queryList.addEventListener('change', onChange);
      return () => queryList.removeEventListener('change', onChange);
    },
    [queryList]
  );
  const getSnapshot = useCallback(() => queryList?.matches ?? false, [queryList]);
  const overlay = useSyncExternalStore(subscribe, getSnapshot);

  // `null` until the user toggles; their choice from then on.
  const [userChoice, setUserChoice] = useState<boolean | null>(null);
  const collapsed = userChoice ?? overlay;
  const toggle = useCallback(() => setUserChoice(!collapsed), [collapsed]);

  return { collapsed, toggle };
}
