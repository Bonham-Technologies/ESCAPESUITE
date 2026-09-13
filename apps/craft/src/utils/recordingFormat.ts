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
