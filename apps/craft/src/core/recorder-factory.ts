/**
 * Factory for creating the best available recorder implementation.
 * Uses WebCodecsRecorder when available (proper WebM containers),
 * falls back to MediaRecorder-based Recorder otherwise.
 */

import { Recorder, type RecorderCallbacks } from './recorder';
import { WebCodecsRecorder, type WebCodecsRecorderCallbacks } from './webcodecs-recorder';
// Note: isWebCodecsRecordingSupported is available but WebCodecs recording is disabled

export type AnyRecorder = Recorder | WebCodecsRecorder;
export type AnyRecorderCallbacks = RecorderCallbacks | WebCodecsRecorderCallbacks;

/**
 * Check if WebCodecs-based recording is available.
 *
 * NOTE: WebCodecs recording is currently disabled due to browser limitations
 * with capturing frames from hidden video elements. Browsers optimize away
 * frame decoding for non-visible elements, causing frozen video output.
 *
 * We keep the WebCodecs infrastructure for post-recording conversion
 * (WebM Compatible, MP4 options) which works reliably.
 */
export function canUseWebCodecsRecorder(): boolean {
  // Disabled - WebCodecs recording has frame capture issues
  // See: https://github.com/mrbonha/ESCAPESUITE/pull/93
  return false;
  // Original: return isWebCodecsRecordingSupported();
}

/**
 * Create the best available recorder implementation.
 * Returns WebCodecsRecorder if WebCodecs is supported, otherwise Recorder.
 */
export function createRecorder(callbacks: AnyRecorderCallbacks): AnyRecorder {
  if (canUseWebCodecsRecorder()) {
    console.log('Using WebCodecs-based recorder for proper WebM containers');
    return new WebCodecsRecorder(callbacks);
  } else {
    console.log('Using MediaRecorder-based recorder (WebCodecs not available)');
    return new Recorder(callbacks);
  }
}

/**
 * Get a description of which recorder implementation is being used
 */
export function getRecorderType(): 'webcodecs' | 'mediarecorder' {
  return canUseWebCodecsRecorder() ? 'webcodecs' : 'mediarecorder';
}
