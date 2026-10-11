// Pure string formatting for the recorder UI: the elapsed-time display and
// a filesystem-safe download name. Everything they need is a parameter, so
// the same functions back the countdown/duration labels, the download
// handler and their tests without a store or a React render in sight.

/** Format a duration in whole-and-fractional seconds as `MM:SS` (floor-truncated). */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Turn a recording's display name into a safe download-filename stem (no extension). */
export function safeFileName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

const COMPANION_SEPARATOR = ' — ';

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * The download filename stem (no extension) for a recording: `recording_` and
 * the take's own local timestamp as `YYYY-MM-DD_HH-mm-ss`, then `_<label>` for
 * a companion row (`… — Webcam`). The display name is rendered with the
 * viewer's locale, whose digits need not be Latin — `safeFileName` turned every
 * one into `_` and every take downloaded as `recording_____…` — so the stem is
 * built from `createdAt` instead, whose digits are Latin by construction
 * (ESCSUITE-230).
 */
export function downloadFileStem(name: string, createdAt: number): string {
  const d = new Date(createdAt);
  const stamp =
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
  const cut = name.lastIndexOf(COMPANION_SEPARATOR);
  const label = cut === -1 ? '' : safeFileName(name.slice(cut + COMPANION_SEPARATOR.length));
  return label ? `recording_${stamp}_${label}` : `recording_${stamp}`;
}
