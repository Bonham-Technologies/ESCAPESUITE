// Theme storage adapter for ESCAPEARTIST
// Uses the app's storage module for IndexedDB access

import type { ThemeStorage, ThemePreference } from '@escapesuite/shared/theme';
import { getSetting, setSetting } from '../core/storage';

const THEME_STORAGE_KEY = 'theme-preference';

/**
 * Theme storage implementation for ESCAPEARTIST
 * Uses the shared IndexedDB database via the storage module
 */
export const themeStorage: ThemeStorage = {
  async load(): Promise<ThemePreference | null> {
    try {
      const stored = await getSetting<ThemePreference>(THEME_STORAGE_KEY);
      if (stored && ['light', 'dark', 'system'].includes(stored)) {
        return stored;
      }
    } catch (e) {
      console.warn('Failed to load theme preference:', e);
    }
    return null;
  },

  async save(preference: ThemePreference): Promise<void> {
    try {
      await setSetting(THEME_STORAGE_KEY, preference);
    } catch (e) {
      console.error('Failed to save theme preference:', e);
    }
  },
};
