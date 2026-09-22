---
'@escapesuite/craft': patch
---

Fix WebM container repair, which had been failing for every MediaRecorder take since the Vite 8 bump.

`webm-duration-fix` is CommonJS (`exports.default` plus `__esModule`), and Vite 8 changed what a default import of such a module binds to: it moved dep optimization and the build to Rolldown and aligned CJS interop with Node's, so the import yielded the whole `module.exports` object instead of the function on it. Calling it threw `TypeError: fixWebmDuration is not a function`; `useRecordingSave` caught that, raised the `NOT_SEEKABLE` notice and stored the raw blob — so PiP takes, audio-only takes and takes in any browser without WebCodecs were saved with no Duration and no Cues and would not scrub. It affected the shipped build, not just the dev server.

`converter.ts` now resolves the import to a function itself, accepting either interop shape, and a real PiP take is recorded and checked for a finite duration in both `apps/e2e` pipelines (dev server and the combined production build) so the regression cannot come back unseen.
