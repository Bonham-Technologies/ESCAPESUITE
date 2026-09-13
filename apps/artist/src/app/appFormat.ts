// Notification-message formatting for the editor shell (App.tsx).
//
// Pure string building: no store, no DOM — just the two shapes App's
// notifications need, kept in one place so the pluralisation rule is
// spelled once instead of three times.
import { formatTime } from '../utils/timeUtils';

/** Format a time (seconds) for display inside a notification message. */
export function formatTimeForNotification(time: number): string {
  return formatTime(time);
}

/** `"<count> clip<s?> <verb>"`, e.g. `"2 clips deleted"` / `"1 clip copied"`. */
export function clipCountMessage(count: number, verb: string): string {
  return `${count} clip${count !== 1 ? 's' : ''} ${verb}`;
}
