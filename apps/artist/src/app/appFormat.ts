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

/**
 * What the toast says when an ESCAPECRAFT handoff lands.
 *
 * Three facts, one sentence, because `useNotification` is a single slot on a
 * three-second timer: raising two messages means the first is never read. A
 * plain take keeps the sentence it has always had; a take that arrived as
 * several tracks says so; and a take that left a part behind says *that*
 * instead, because it is the half the user can still do something about.
 */
export function takeLoadedMessage(name: string, placed: number, missing: number): string {
  if (missing > 0) {
    return `Loaded recording: ${name} — ${missing} missing part${missing === 1 ? '' : 's'} skipped`;
  }
  if (placed > 1) {
    return `Loaded recording: ${name} (${placed} tracks)`;
  }
  return `Loaded recording: ${name}`;
}
