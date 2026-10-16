---
"@escapesuite/headless-artist": patch
---

A project whose track carries a `kind` other than `'captions'` is now refused by name

The kit validates projects with the editor's own `parseProject`, which now knows the caption-track marker: a project with a Captions track renders its captions like any text clips, and a track whose `kind` is anything but `'captions'` fails the job with `timeline.tracks[i].kind must be 'captions'` before a render starts.
