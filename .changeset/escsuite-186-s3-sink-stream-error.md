---
'@escapesuite/headless-artist': patch
---

The s3 output sink no longer crashes the process when a client rejects (or resolves) an upload without reading the render's stream body.

`deliver()` hands each PutObject a `createReadStream(outputPath)` whose file handle opens asynchronously, on a later tick, whether or not anything ever reads it. A client that fails fast — a validation error, a network failure before the SDK starts piping the body, or an embedder-supplied client that never touches it — left that deferred open free to fail after a caller had already removed the job's work directory (which `serve` and `render` both do unconditionally once `deliver()` settles), surfacing as an uncaught exception instead of the `{ ok: false }` result a failed render is supposed to come back as. The stream now carries its own error listener and is explicitly released as soon as `send()` settles, so a never-read body can no longer outlive the call that created it.
