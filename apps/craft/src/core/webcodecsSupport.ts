// The two synchronous capability questions the recorder and the UI both ask.
//
// They live here rather than in `webcodecs-recorder.ts` because a *component*
// has to ask one of them — the separate-tracks toggle is disabled with a
// visible reason where the browser cannot serve it — and importing the recorder
// would pull `mediabunny` into that component's module graph (and into every
// App suite that mocks the recorder factory but not the muxer). This module
// imports nothing.

/**
 * Check if WebCodecs recording is supported
 */
export function isWebCodecsRecordingSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

/**
 * Whether this browser can record the webcam as a separate track.
 *
 * WebCodecs, plus `MediaStreamTrackProcessor`: the webcam pipeline reads frames
 * from a track processor and has **no** `<video>`+canvas fallback. The primary
 * pipeline keeps its fallback because a take must record *something*; a second
 * hidden `<video>` and a second capture canvas is a cost the opt-in mode does
 * not need to pay, and every browser with WebCodecs shipped the track processor
 * alongside it. Firefox and Safari have neither, so the toggle is disabled
 * there with the reason said out loud (`utils/separateTracksReadiness.ts`).
 */
export function canRecordSeparateTracks(): boolean {
  return isWebCodecsRecordingSupported() && 'MediaStreamTrackProcessor' in globalThis;
}
