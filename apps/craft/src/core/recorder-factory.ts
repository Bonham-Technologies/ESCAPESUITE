import { Recorder, type RecorderCallbacks } from './recorder';
import { WebCodecsRecorder, type WebCodecsRecorderCallbacks } from './webcodecs-recorder';
import { canRecordSeparateTracks, isWebCodecsRecordingSupported } from './webcodecsSupport';

export type AnyRecorder = Recorder | WebCodecsRecorder;
export type AnyRecorderCallbacks = RecorderCallbacks | WebCodecsRecorderCallbacks;

/**
 * Check if WebCodecs-based recording can be used for the given mode.
 *
 * WebCodecs recording produces seekable WebM with proper keyframes and Cues.
 * It works reliably for screen-only and webcam-only modes where the video
 * source is a direct stream (not a compositor canvas).
 *
 * **Composited** PiP mode uses MediaRecorder because the compositor's hidden
 * video elements cause frame capture issues with WebCodecs (browsers optimize
 * away decoding for non-visible elements). A **separate-tracks** PiP take is
 * the exception and not a contradiction: there the recorder reads the raw
 * screen and webcam tracks and the compositor only draws the preview, so no
 * frame is ever captured through it (ESCSUITE-14).
 *
 * An audio-only take (both video sources switched off, which SourceToggles
 * allows) also uses MediaRecorder: WebCodecsRecorder is built around a video
 * track and throws 'No video track available for recording' without one, while
 * MediaRecorder records the mixed audio track perfectly well on its own.
 *
 * @param isPiP - Whether PiP mode is active
 * @param hasVideoSource - Whether the take captures screen or webcam at all
 * @param separateTracks - Whether the webcam is recorded as its own file
 */
export function canUseWebCodecsRecorder(
  isPiP: boolean = false,
  hasVideoSource: boolean = true,
  separateTracks: boolean = false
): boolean {
  if (!hasVideoSource) return false;
  if (isPiP && !separateTracks) return false;
  // Two pipelines need the track processor as well as WebCodecs; one does not.
  return separateTracks ? canRecordSeparateTracks() : isWebCodecsRecordingSupported();
}

/**
 * Create the best available recorder for the given mode.
 * @param callbacks - Recorder event callbacks
 * @param isPiP - Whether PiP mode is active (forces MediaRecorder unless the
 *   webcam is being recorded as its own track)
 * @param hasVideoSource - Whether the take captures screen or webcam at all
 *   (an audio-only take forces MediaRecorder)
 * @param separateTracks - Whether the webcam is recorded as its own file
 */
export function createRecorder(
  callbacks: AnyRecorderCallbacks,
  isPiP: boolean = false,
  hasVideoSource: boolean = true,
  separateTracks: boolean = false
): AnyRecorder {
  if (canUseWebCodecsRecorder(isPiP, hasVideoSource, separateTracks)) {
    console.log(
      `Using WebCodecs-based recorder (seekable output)${separateTracks ? ' (separate tracks)' : ''}`
    );
    return new WebCodecsRecorder(callbacks);
  } else {
    console.log(`Using MediaRecorder-based recorder${isPiP ? ' (PiP mode)' : ''}`);
    return new Recorder(callbacks);
  }
}

export function getRecorderType(
  isPiP: boolean = false,
  hasVideoSource: boolean = true,
  separateTracks: boolean = false
): 'webcodecs' | 'mediarecorder' {
  return canUseWebCodecsRecorder(isPiP, hasVideoSource, separateTracks)
    ? 'webcodecs'
    : 'mediarecorder';
}
