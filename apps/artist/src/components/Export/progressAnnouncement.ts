/**
 * When the export dialog's live region is allowed to speak (ESCSUITE-215).
 *
 * An export reports progress once per encoded frame — thousands of reports
 * over a run that can last minutes. A live region fed every one of them is
 * worse than silence: a screen reader interrupts itself on each change and the
 * user hears the first syllable of every frame and the whole of none. So the
 * dialog announces on the first report of a run, then at most once per
 * ten-percentage-point band, with a five-second floor so an export that sits
 * inside one band (a long 4K encode) still says it is alive.
 *
 * Kept here, pure and dependency-free, rather than inline in the component:
 * the rule is the interesting part and it can be read, tested and mutated
 * without driving an export.
 */

/** What the dialog remembers about the announcement it last made. */
export interface ProgressAnnouncement {
  /** The percentage (0–100) that announcement was made at. */
  progress: number;
  /** `Date.now()` when it was made. */
  atMs: number;
}

/** Announce on each new multiple of this many percentage points. */
export const ANNOUNCE_STEP_PERCENT = 10;

/** …and at least this often regardless, so a slow band is not silence. */
export const ANNOUNCE_INTERVAL_MS = 5000;

/**
 * Whether a report at `next` percent, made at `nowMs`, is worth announcing
 * given the last announcement (`previous`, or `null` on the first report of a
 * run — a run always announces its first report).
 */
export function shouldAnnounceProgress(
  previous: ProgressAnnouncement | null,
  next: number,
  nowMs: number
): boolean {
  if (previous === null) return true;
  // A *comparison*, not a difference: progress that somehow went backwards
  // must not read as a new band.
  const reachedNewBand =
    Math.floor(next / ANNOUNCE_STEP_PERCENT) > Math.floor(previous.progress / ANNOUNCE_STEP_PERCENT);
  if (reachedNewBand) return true;
  return nowMs - previous.atMs >= ANNOUNCE_INTERVAL_MS;
}
