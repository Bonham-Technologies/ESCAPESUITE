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
 *
 * An audio-only take (both video sources switched off, which SourceToggles
 * allows) also uses MediaRecorder: WebCodecsRecorder is built around a video
 * track and throws 'No video track available for recording' without one, while
 * MediaRecorder records the mixed audio track perfectly well on its own.
 *
 * @param isPiP - Whether PiP mode is active
 * @param hasVideoSource - Whether the take captures screen or webcam at all
 */
export function canUseWebCodecsRecorder(isPiP: boolean = false, hasVideoSource: boolean = true): boolean {
  if (isPiP) return false;
  if (!hasVideoSource) return false;
  return isWebCodecsRecordingSupported();
}

/**
 * Create the best available recorder for the given mode.
 * @param callbacks - Recorder event callbacks
 * @param isPiP - Whether PiP mode is active (forces MediaRecorder)
 * @param hasVideoSource - Whether the take captures screen or webcam at all
 *   (an audio-only take forces MediaRecorder)
 */
export function createRecorder(
  callbacks: AnyRecorderCallbacks,
  isPiP: boolean = false,
  hasVideoSource: boolean = true
): AnyRecorder {
  if (canUseWebCodecsRecorder(isPiP, hasVideoSource)) {
    console.log('Using WebCodecs-based recorder (seekable output)');
    return new WebCodecsRecorder(callbacks);
  } else {
    console.log(`Using MediaRecorder-based recorder${isPiP ? ' (PiP mode)' : ''}`);
    return new Recorder(callbacks);
  }
}

export function getRecorderType(
  isPiP: boolean = false,
  hasVideoSource: boolean = true
): 'webcodecs' | 'mediarecorder' {
  return canUseWebCodecsRecorder(isPiP, hasVideoSource) ? 'webcodecs' : 'mediarecorder';
}
