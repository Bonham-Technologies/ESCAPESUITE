// Why "Record webcam as a separate track" cannot be switched on, and the
// sentence the toggle says out loud when it cannot.
//
// The mirror of `utils/recordReadiness.ts`: a pure gate with its reasons beside
// it rather than in `utils/notices.ts`, because nothing has gone wrong — the
// same reason `NO_STORAGE_SPACE` lives next to the record button's gate and the
// MP4 button's reasons live next to the codec probe.

/**
 * No WebCodecs (Firefox, Safari), or no `MediaStreamTrackProcessor`.
 *
 * The mode needs two `VideoEncoder`s on one clock; two MediaRecorders would
 * produce two files with no shared start time, which is the one property the
 * feature exists for. Naming the browsers that can is the actionable half.
 */
export const SEPARATE_TRACKS_NO_WEBCODECS_REASON =
  'This browser cannot record two tracks at once — Chrome or Edge can.'

/**
 * The storage headroom check, run for roughly double the bitrate.
 *
 * The two video encoders dominate the size — the webcam and any audio
 * companions (microphone, system audio) are Opus, a rounding error next to
 * two VP9 tracks — so the same take needs about twice the room. The check
 * errs toward letting you record (see `hasSpaceForRecording`), so reaching
 * this sentence means the browser really did say no.
 */
export const SEPARATE_TRACKS_NO_SPACE_REASON =
  'Not enough storage for two tracks — delete a recording first.'

/**
 * Why the separate-tracks toggle is disabled, or null when it is offered.
 *
 * The browser's answer comes first: a user in Safari cannot act on "not enough
 * storage", and the browser is the truer reason when both are true.
 */
export function separateTracksBlockedReason(
  supported: boolean,
  hasSpace: boolean
): string | null {
  if (!supported) return SEPARATE_TRACKS_NO_WEBCODECS_REASON
  if (!hasSpace) return SEPARATE_TRACKS_NO_SPACE_REASON
  return null
}
