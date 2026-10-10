---
'@escapesuite/shared': patch
---

`SourceVideo` gains an optional `frameRateSource` saying where its frame rate came from

`frameRateSource` is `'measured'` when ESCAPEARTIST measured the rate from the file's own frames at import, `'configured'` when ESCAPECRAFT wrote the rate its recorder was configured to capture at, and `'assumed'` for a fallback nothing measured. It is additive and optional: every record written before it has no field, which reads the same as `'assumed'`, and the database version does not change.
