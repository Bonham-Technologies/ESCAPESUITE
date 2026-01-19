/**
 * Factory for creating the best available recorder implementation.
 * Uses WebCodecsRecorder when available (proper WebM containers),
 * falls back to MediaRecorder-based Recorder otherwise.
 */

import { Recorder, type RecorderCallbacks } from './recorder';
import { WebCodecsRecorder, isWebCodecsRecordingSupported, type WebCodecsRecorderCallbacks } from './webcodecs-recorder';

export type AnyRecorder = Recorder | WebCodecsRecorder;
export type AnyRecorderCallbacks = RecorderCallbacks | WebCodecsRecorderCallbacks;

/**
 * Check if WebCodecs-based recording is available
 */
export function canUseWebCodecsRecorder(): boolean {
  return isWebCodecsRecordingSupported();
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
