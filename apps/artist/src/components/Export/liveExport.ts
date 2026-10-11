// The export in flight, reachable from outside React (ESCSUITE-220).
//
// An MP4, WebM or GIF export owns things that outlive the component that
// started it — a decodeWorker (through VideoDecodeManager), one or two
// VideoEncoders and an AudioEncoder, a mediabunny muxer — and its only
// release paths are its own completion, failure and Cancel. A render-time
// throw anywhere else in the editor unmounts ExportDialog through the app's
// ErrorBoundary, which reaches none of those, so the export used to run on
// behind the error panel until Reload: minutes of pegged CPU on exactly the
// low-spec machine this suite is built for.
//
// The shape is ESCAPECRAFT's `disposeLiveRecordingSession`
// (`apps/craft/src/hooks/useRecordingController.ts`): one module-level slot
// and one function `main.tsx` hands the boundary as `onError`. It lives in
// its own module so `main.tsx` imports no React component to reach it.
//
// Ordering: `componentDidCatch` runs during the commit that swaps the crashed
// tree for the fallback, before that subtree's passive effect cleanups — and
// ExportDialog has no unmount path that touches the slot anyway; only a run's
// own `finally` (asynchronous, after its promise settles) and `handleCancel`
// clear it. So the slot still names the live run when `onError` fires.
// ExportDialog.test.tsx's ordering pin asserts that under the real boundary.

/** The live run's controller, or `null` when no export is in flight. */
let liveExport: AbortController | null = null;

/** Called by ExportDialog when a run starts: the newest run is the live one. */
export function registerLiveExport(controller: AbortController): void {
  liveExport = controller;
}

/**
 * Called by ExportDialog when a run settles (its `finally`) or is cancelled.
 * Only clears the slot if it still names *this* run: a cancelled run's
 * promise usually settles at its next internal `await`, which can be after
 * the run started next has already registered, and dropping that newer
 * registration would leave a crash unable to stop the export actually running.
 */
export function clearLiveExport(controller: AbortController): void {
  if (liveExport === controller) {
    liveExport = null;
  }
}

/**
 * Abort the export in flight, if there is one — exactly once: the slot is
 * emptied before the abort, so a second call (or the run's own `finally`
 * clearing it afterwards) finds nothing. A no-op with nothing registered,
 * which is the right answer rather than a thing to guard against upstream:
 * the ErrorBoundary calling this cannot know whether an export was running.
 * The abort reaches the exporter through the signal it was handed, and the
 * exporter's own abort path closes its encoders, its muxer and the decode
 * worker, exactly as Cancel does.
 */
export function disposeLiveExport(): void {
  const controller = liveExport;
  liveExport = null;
  controller?.abort();
}
