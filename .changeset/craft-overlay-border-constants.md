---
'@escapesuite/craft': patch
---

Internal only, with no change to what anything records or draws: the webcam overlay's border
colour and width, and its corner radius, are now named constants in
`core/overlayGeometry.ts` rather than literals repeated at four call sites.

ESCAPEARTIST reproduces the same border on a handed-over webcam clip (ESCSUITE-65), so both
apps now name the same numbers in one place each and a change to the border here cannot
silently stop matching what the editor draws. The live preview, a composited
picture-in-picture recording and a re-composited MP4 all paint exactly the pixels they did
before — pinned by the compositor, converter and overlay-geometry suites, which are unchanged.
