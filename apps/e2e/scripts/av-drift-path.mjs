/**
 * The capture-path branch of `av-drift-report.mjs` (ESCSUITE-320), pulled out
 * so node:test can reach it (the report itself runs on import). A
 * `measurement.json` written before the rig recorded `capturePath` has none,
 * and is read exactly as it always was.
 */
export const WORKLET_CALLBACKS_CELL = 'n/a (AudioWorklet)'
export const WORKLET_H1A_VERDICT =
  '**H1a**: n/a — the worklet carries the audio; no ScriptProcessor callbacks to count.'

export const isWorkletTake = (m) => m.capturePath === 'worklet'

/** The lost-callbacks cell: the worklet's "n/a", else `legacy` (the ScriptProcessor / MediaRecorder reading, unchanged). */
export const lostCallbacksCell = (m, legacy) => (isWorkletTake(m) ? WORKLET_CALLBACKS_CELL : legacy)
