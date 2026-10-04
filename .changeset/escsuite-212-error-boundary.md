---
'@escapesuite/shared': patch
'@escapesuite/craft': patch
'@escapesuite/artist': patch
---

Neither app had a React error boundary, so a render-time bug anywhere in the tree used to unmount the whole thing to a blank page — and in ESCAPECRAFT, whatever recorder was live kept capturing into a UI nobody could see or stop.

`@escapesuite/shared` gets one `ErrorBoundary` component, mounted by `bootstrapApp()` around every app's root. It shows one minimal, accessible panel — a heading, one sentence, a Reload button, `role="alert"` — with no app-specific copy, logs the error to the console in dev only, and calls an optional `onError(error, info)` so a host app can release anything a crash would otherwise leave dangling.

ESCAPECRAFT passes an `onError` that disposes the live take: the same `disposeRecorder()` and `stopAllStreamsRef.current()` the unmount teardown already calls, now reachable from outside React because `onError` is bound once at bootstrap, before any component (and so any ref) exists. ESCAPEARTIST holds no live capture a crash could leave running, so its `onError` is a documented no-op.
