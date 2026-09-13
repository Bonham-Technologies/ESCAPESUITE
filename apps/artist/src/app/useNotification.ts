// The editor shell's transient status toast.
//
// One slot, not a queue: `showNotification` overwrites whatever is showing and
// opens a fresh three-second timer. The hook owns that timer — it is held in a
// ref so that showing a second notification can cancel the first one's clear
// (which would otherwise blank the newer message early) and so that unmounting
// leaves nothing armed.
//
// The ref is what makes both of those possible without touching identity:
// `showNotification` still depends on `[]`, which
// `useTimelineHeight`/`useSessionRestore`/`useAppKeyboardShortcuts`/
// `useProjectActions`/`useHostIntegration` all rely on as a stable dependency.
//
// Its one effect exists only to clear the timer on unmount, so it may still sit
// anywhere in `App`'s hook order; it is second because every hook after it
// takes `showNotification` as a parameter.
import { useCallback, useEffect, useRef, useState } from 'react';

/** How a notification is styled, and how urgently it reads. */
export type NotificationType = 'info' | 'error' | 'success';

/** The toast currently showing. */
export interface Notification {
  message: string;
  type: NotificationType;
}

/** Show a notification for three seconds. Defaults to `'info'`. */
export type ShowNotification = (message: string, type?: NotificationType) => void;

/** The toast, and the way to raise one. */
export interface NotificationApi {
  /** The notification to render, or `null` when nothing is showing. */
  notification: Notification | null;
  showNotification: ShowNotification;
}

export function useNotification(): NotificationApi {
  const [notification, setNotification] = useState<Notification | null>(null);
  /** The pending clear, so the next notification — or unmounting — can cancel it. */
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show notification
  //
  // The handle lives in a ref rather than in the closure, so this stays a
  // `[]` callback with an identity that never changes while still being able
  // to cancel the clear a previous notification armed.
  const showNotification = useCallback((message: string, type: NotificationType = 'info') => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setNotification({ message, type });
    clearTimerRef.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  // Leave nothing armed behind: a timer that outlived the hook would set state
  // on a component that has gone.
  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  return { notification, showNotification };
}
