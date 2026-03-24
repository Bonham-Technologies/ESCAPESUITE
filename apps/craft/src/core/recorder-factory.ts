import { Recorder, type RecorderCallbacks } from './recorder';
import { WebCodecsRecorder, isWebCodecsRecordingSupported, type WebCodecsRecorderCallbacks } from './webcodecs-recorder';

export type AnyRecorder = Recorder | WebCodecsRecorder;
export type AnyRecorderCallbacks = RecorderCallbacks | WebCodecsRecorderCallbacks;

/**
 * Check if WebCodecs-based recording can be used for the given mode.
 *
 * WebCodecs recording produces seekable WebM with proper keyframes and Cues.
 * It works reliably for screen-only and webcam-only modes where the video
 * source is a direct stream (not a compositor canvas).
 *
 * PiP mode uses MediaRecorder because the compositor's hidden video elements
 * cause frame capture issues with WebCodecs (browsers optimize away decoding
 * for non-visible elements).
 */
export function canUseWebCodecsRecorder(isPiP: boolean = false): boolean {
  if (isPiP) return false;
  return isWebCodecsRecordingSupported();
}

/**
 * Create the best available recorder for the given mode.
 * @param callbacks - Recorder event callbacks
 * @param isPiP - Whether PiP mode is active (forces MediaRecorder)
 */
export function createRecorder(callbacks: AnyRecorderCallbacks, isPiP: boolean = false): AnyRecorder {
  if (canUseWebCodecsRecorder(isPiP)) {
    console.log('Using WebCodecs-based recorder (seekable output)');
    return new WebCodecsRecorder(callbacks);
  } else {
    console.log(`Using MediaRecorder-based recorder${isPiP ? ' (PiP mode)' : ''}`);
    return new Recorder(callbacks);
  }
}

export function getRecorderType(isPiP: boolean = false): 'webcodecs' | 'mediarecorder' {
  return canUseWebCodecsRecorder(isPiP) ? 'webcodecs' : 'mediarecorder';
}
