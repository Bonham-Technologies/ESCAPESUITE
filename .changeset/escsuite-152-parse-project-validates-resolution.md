---
'@escapesuite/artist': patch
---

A project with a broken resolution — 0x0, a string, negative numbers, or anything past
8K — is now refused when it loads instead of reaching the video encoder and failing deep
inside an export. This closes a gap where a misbehaving host embedding ARTIST could hand it
`LOAD_PROJECT` with a `resolution: { width: 0, height: 0 }` payload and have it silently
accepted; it now comes back with a clear "resolution" error instead. Normal odd dimensions
(1921x1081, say) and a project with no resolution field at all still work exactly as before.
Both the MP4 and WebM exporters also gained a defensive check of their own, so a bad
resolution can never reach the encoder even from a caller that builds its export options by
hand.
