// Shared types and utilities for ESCAPE Suite
// Add shared code here as needed

export const ESCAPE_SUITE_VERSION = '1.0.0';

// Shared IndexedDB database name used by CRAFT and ARTIST
export const SHARED_DB_NAME = 'video-editor-db';

// Theme types for cross-app consistency
export type Theme = 'light' | 'dark' | 'system';

// Common environment detection
export const isBrowser = typeof window !== 'undefined';
export const isProduction = import.meta.env?.PROD ?? false;
