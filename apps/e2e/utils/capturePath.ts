/**
 * Which audio capture path a take really used (ESCSUITE-320). The A/V drift
 * rig's instruments see ScriptProcessor callbacks only; since ESCSUITE-299 a
 * WebCodecs take's audio goes through an AudioWorklet instead, so "no
 * ScriptProcessor node" no longer means "MediaRecorder". The recorder says
 * which path it chose in one `console.info` line
 * (`apps/craft/src/core/audioWorkletCapture.ts`, `choosePath`); this maps it.
 *
 * Pure and import-free so `scripts/capture-path.test.mjs` can run it under
 * node:test.
 */
export type CapturePath = 'worklet' | 'script-processor' | 'media-recorder'

export const CAPTURE_PATHS: readonly CapturePath[] = ['worklet', 'script-processor', 'media-recorder']

/** The recorder's own line → the path it names, or `null` for any other line. */
export function capturePathFromLine(line: string): CapturePath | null {
  if (line.startsWith('Recording audio through an AudioWorklet (')) return 'worklet'
  if (line.startsWith('Recording audio through a ScriptProcessorNode')) return 'script-processor'
  return null
}

/**
 * The path of a take: a MediaRecorder take never reaches the capture code, so
 * the recorder choice decides it; a WebCodecs take is whichever path the first
 * recorder line names (`null` when it logged none).
 */
export function resolveCapturePath(lines: readonly string[], recorder: string): CapturePath | null {
  if (recorder === 'mediarecorder') return 'media-recorder'
  for (const line of lines) {
    const path = capturePathFromLine(line)
    if (path) return path
  }
  return null
}

/** The path an arm means to measure; `override` (AV_DRIFT_EXPECT_PATH) wins when set. */
export function expectedCapturePath(recorder: string, override?: string): CapturePath {
  if (override !== undefined && override !== '') {
    if (!(CAPTURE_PATHS as readonly string[]).includes(override)) {
      throw new Error(`AV_DRIFT_EXPECT_PATH=${override} is not one of ${CAPTURE_PATHS.join(', ')}`)
    }
    return override as CapturePath
  }
  return recorder === 'mediarecorder' ? 'media-recorder' : 'worklet'
}
