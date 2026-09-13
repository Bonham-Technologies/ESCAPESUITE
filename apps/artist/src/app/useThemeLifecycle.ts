// The editor shell's theme lifecycle.
//
// `App` calls this first, ahead of every other hook, because the order the
// hooks are called in is the order their effects run in, and the theme was
// the first effect in `App.tsx` when all six were inline. Everything the
// editor mounts below it therefore finds the document already themed.
import { useEffect } from 'react';
import { initTheme, cleanupTheme } from '@escapesuite/shared/theme';
import { themeStorage } from '../utils/themeStorage';

/** Start the shared theme module on mount and stop it on unmount. */
export function useThemeLifecycle(): void {
  // Initialize theme on mount
  useEffect(() => {
    initTheme(themeStorage);
    return () => cleanupTheme();
  }, []);
}
