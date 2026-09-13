import type { Notification } from './useNotification';
import styles from '../App.module.css';

interface NotificationToastProps {
  /**
   * The notification to show. Never null — the `{notification && …}` guard
   * stays in `App`, so nothing is rendered rather than an empty live region.
   */
  notification: Notification;
}

/** The transient status toast in the corner of the editor. */
export function NotificationToast({ notification }: NotificationToastProps) {
  return (
    <div className={`${styles.notification} ${styles[notification.type]}`} role="status" aria-live="polite">
      {notification.message}
    </div>
  );
}
