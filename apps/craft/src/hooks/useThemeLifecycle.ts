// The recorder screen's theme lifecycle: one effect, mount and unmount.
//
// It is the first hook App calls, because it was the first effect in the file
// and effect order across App is reproduced by hook-call order.
import { useEffect } from 'react';
import { initTheme, cleanupTheme } from '@escapesuite/shared/theme';
import { themeStorage } from '../utils/themeStorage';

/** Initialize the shared theme on mount and tear it down on unmount. */
export function useThemeLifecycle(): void {
  // Initialize theme on mount
  useEffect(() => {
    initTheme(themeStorage);
    return () => cleanupTheme();
  }, []);
}
