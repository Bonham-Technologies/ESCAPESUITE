// The one place the three companion roles differ in words.
//
// A take is several files now (ESCSUITE-14), and almost everything that
// follows from that is the same sentence with a different noun in it: the
// stored part's name, the library row's prefix, and the five things that can
// be said to have gone wrong with a part. Keeping the nouns here means each
// piece of copy exists once, a fourth role is one entry rather than a grep,
// and the tests that pin the wording have one place to point at.
//
// Two forms of the same noun, because English: `label` goes mid-sentence
// ("the webcam companion could not be flushed"), `trackLabel` starts one
// ("Webcam track could not be saved"). Deriving one from the other would work
// for two of the three and break on "system audio".
import type { CompanionRole, RecordingRole } from '../store/types'

export interface CompanionPartDescriptor {
  /** Mid-sentence: "the {label} companion could not be finalized". */
  label: string
  /** Sentence-initial: "{trackLabel} track could not be saved". */
  trackLabel: string
  /** Whether this part is sound rather than pictures — see `recordingMetadata`. */
  isAudio: boolean
}

export const COMPANION_PARTS: Record<CompanionRole, CompanionPartDescriptor> = {
  webcam: { label: 'webcam', trackLabel: 'Webcam', isAudio: false },
  mic: { label: 'microphone', trackLabel: 'Microphone', isAudio: true },
  system: { label: 'system audio', trackLabel: 'System audio', isAudio: true },
}

/**
 * The descriptor for a stored part's role, or null when the part is the take
 * itself.
 *
 * `undefined` and `'screen'` are the same answer on purpose: a recording made
 * before ESCSUITE-14 has no role at all, and the primary of a companion take
 * has `'screen'`. Neither is a companion.
 */
export function companionPartFor(
  role: RecordingRole | undefined
): CompanionPartDescriptor | null {
  return role === undefined || role === 'screen' ? null : COMPANION_PARTS[role]
}

/**
 * The order a take's companion parts are listed in, everywhere: the camera
 * first, then the microphone, then the system audio.
 *
 * Typed as plain strings on purpose. `CompanionRole` is a compile-time union
 * and IndexedDB is not type-checked, so "is this a role we know?" has to be a
 * runtime question — a part written by a newer ESCAPECRAFT sorts last rather
 * than crashing the sort.
 *
 * It lives beside `COMPANION_PARTS` because this is the module that exists so
 * the roles are described in exactly one place; `utils/takeOrder.ts` (the
 * library's row order) and `utils/takeParts.ts` (the upload's part order) both
 * read it, and a fourth role is one entry here rather than two greps.
 */
export const COMPANION_ROLE_ORDER: readonly string[] = ['webcam', 'mic', 'system']

/** Where a companion sits in its take's stack; last for a role we do not know. */
export function companionRank(role: string | undefined): number {
  const rank = COMPANION_ROLE_ORDER.indexOf(role ?? '')
  return rank === -1 ? COMPANION_ROLE_ORDER.length : rank
}
