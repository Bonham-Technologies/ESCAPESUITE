// Constants for the editor shell (App.tsx): auto-save timing and the
// timeline panel's resizable-height bounds and persistence key.
//
// Pure data, no behaviour — kept in one place so timelineHeight.ts and
// App.tsx read the same numbers rather than each spelling them out.

/** Auto-save debounce delay, in milliseconds. */
export const AUTO_SAVE_DELAY = 2000;

/** Shortest the timeline panel can be dragged, in pixels. */
export const MIN_TIMELINE_HEIGHT = 120;

/** Tallest the timeline panel can be dragged, in pixels. */
export const MAX_TIMELINE_HEIGHT = 600;

/** Timeline panel height on a first visit, before anything is persisted, in pixels. */
export const DEFAULT_TIMELINE_HEIGHT = 320;

/** LocalStorage key the timeline panel's height is persisted under. */
export const TIMELINE_HEIGHT_KEY = 'escapeartist-timeline-height';
