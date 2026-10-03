// Whether the Record button can do anything yet, and what to say when it
// cannot.
//
// The button used to be live from the first paint: `capabilities` start
// all-false while `detectCapabilities()` is still resolving, so an early click
// reached `acquireStreams()`, took no branch, handed the recorder nothing and
// died in a console.error nobody sees. This is the gate that stops it, and the
// reason the user is shown instead.
//
// **System audio is deliberately not a source of its own.** It is not
// requested separately — `acquireStreams()` asks for it as part of the screen
// capture — so a take with only "System Audio" on captures nothing at all.
// The three sources counted here are exactly the three `acquireStreams()` asks
// for, each gated on "the toggle AND the capability", which is the same test
// the acquisition itself applies.
//
// Storage headroom is the fourth reason, and it is *here* rather than inside
// `handleStartRecording` on purpose: `getDisplayMedia` needs the click's user
// activation, so nothing may be awaited between the click and the capture
// request. The headroom is measured on mount, after every save and after every
// delete, and read from the store — so the button is already disabled, with
// the reason on screen, before the user clicks.
import type { EnvironmentCapabilities, RecordingConfig } from '../store/types'
import { SEPARATE_TRACKS_NO_SPACE_REASON } from './separateTracksReadiness'

export const CHECKING_CAPABILITIES = 'Checking what this browser can capture…'
export const NO_SOURCE_ENABLED = 'Turn on a source before recording'
export const NO_SOURCE_AVAILABLE = 'None of the sources you turned on are available in this browser'
export const NO_STORAGE_SPACE =
  'Not enough storage space left for a new recording — delete a recording and try again.'

/** The reason the Record button must not start a take, or null if it may. */
export function recordBlockedReason(
  capabilitiesReady: boolean,
  config: RecordingConfig,
  capabilities: EnvironmentCapabilities,
  hasStorageSpace: boolean,
  /**
   * Headroom for a separate-tracks take specifically — roughly double a plain
   * one (`SEPARATE_TRACKS_SIZE_FACTOR` in `store/recorderStore.ts`). Asked
   * only when the mode would actually run: a separate-tracks toggle left on
   * in a PiP take. Before this (ESCSUITE-176), the same headroom check only
   * ever reached the toggle itself — which can disable switching the mode
   * *on*, but not a take already configured for it — so the button stayed
   * live and the take started at double the size it had room for.
   */
  hasSeparateTracksSpace: boolean
): string | null {
  if (!capabilitiesReady) {
    return CHECKING_CAPABILITIES
  }

  if (!config.screenEnabled && !config.webcamEnabled && !config.microphoneEnabled) {
    return NO_SOURCE_ENABLED
  }

  const anyAvailable =
    (config.screenEnabled && capabilities.screenCapture) ||
    (config.webcamEnabled && capabilities.webcam) ||
    (config.microphoneEnabled && capabilities.microphone)

  if (!anyAvailable) {
    return NO_SOURCE_AVAILABLE
  }

  if (!hasStorageSpace) {
    return NO_STORAGE_SPACE
  }

  // Last, because it is the narrowest of the storage reasons: a separate-
  // tracks take is a PiP take (both screen and webcam) with the toggle on.
  // Anything else needs no more room than the plain check above already
  // guaranteed.
  if (
    config.separateTracks &&
    config.screenEnabled &&
    config.webcamEnabled &&
    !hasSeparateTracksSpace
  ) {
    return SEPARATE_TRACKS_NO_SPACE_REASON
  }

  return null
}
