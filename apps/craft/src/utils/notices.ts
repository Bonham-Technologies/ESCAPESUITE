// Everything ESCAPECRAFT has to tell the user that is not a state change.
//
// There is exactly ONE notice channel: `notice` in the recorder store, which
// `AppHeader` renders inside the header's `aria-live="polite"` region. A
// notice is raised by whichever path discovered the problem and cleared when
// the next take starts — see `useRecordingController.handleStartRecording`.
// Anything that needs a second channel needs a design discussion first, not a
// second store field.
export const SAVE_FAILED =
  'The recording could not be saved — it is not in your library.'

export const NOT_SEEKABLE =
  'Saved, but the recording may not be seekable — the container repair failed.'

export const CAPTURE_REFUSED =
  'The browser refused the capture — nothing was recorded.'

export const START_FAILED = 'The recording could not be started.'

export const LIBRARY_UNREADABLE =
  'Your saved recordings could not be loaded — storage may be blocked in this browser.'

export const DETECTION_FAILED =
  'This browser would not say what it can capture — some sources may be unavailable.'

export const NO_SYSTEM_AUDIO =
  "System audio was not shared — tick 'Share system audio' in the browser dialog."
