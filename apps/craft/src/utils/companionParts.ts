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
