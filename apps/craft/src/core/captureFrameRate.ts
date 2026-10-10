/**
 * The frame rate every ESCAPECRAFT capture is configured at (ESCSUITE-276).
 *
 * One constant for the whole recording path, so the rate a take is stored
 * with is the rate it was asked for rather than a second literal that happens
 * to agree: the `frameRate` constraint `permissions.ts` asks `getDisplayMedia`
 * and `getUserMedia` for, the rate the `Compositor` draws at and its
 * `captureStream` samples (composited PiP, MediaRecorder), the `VideoEncoder`
 * framerate and frame clock in `WebCodecsRecorder`, and the `frameRate`
 * `buildSourceVideo` writes, labelled `'configured'`.
 *
 * "Configured", not "measured": a constraint is `ideal`, and a window or tab
 * can deliver fewer frames than asked — `WebCodecsRecorder` already stamps its
 * frames on this clock for that reason.
 */
export const CAPTURE_FRAME_RATE = 30;
