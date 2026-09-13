// The editor shell's transient status toast.
//
// One slot, not a queue: `showNotification` overwrites whatever is showing and
// opens a fresh three-second timer. The timer is deliberately neither stored
// nor cleared — see the note on `showNotification` — because that is what the
// editor has always done, and the App suite pins the behaviour.
//
// Binds no effect, so it may sit anywhere in `App`'s hook order; it is second
// because every hook after it takes `showNotification` as a parameter.
import { useCallback, useState } from 'react';

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
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'error' | 'success' } | null>(null);

  // Show notification
  //
  // The timeout is not captured, so a second notification inside three seconds
  // leaves the first one's timer running and it blanks the newer message early.
  // Known, carried deliberately: `useNotification.test.ts` pins it as a finding.
  const showNotification = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  return { notification, showNotification };
}
