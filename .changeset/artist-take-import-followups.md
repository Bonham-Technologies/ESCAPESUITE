---
'@escapesuite/artist': patch
---

Two fixes to the ESCAPECRAFT take handoff (ESCSUITE-69).

**The webcam's corner inset on a recording narrower than 1280 px.**
`overlayPlacementToTransform` read the compositor's 20 px inset as 20/1280 of the frame at
every width, on the assumption that the preview canvas is always capped at 1280. It is
capped only *above* 1280 and a narrower share is never scaled up, so a 640-wide screen
share was previewed — and composited into a downloaded MP4 — with a flat 20 px, while
ESCAPEARTIST imported the camera 10 px from the edge: half as far. `overlayMarginFor` now
mirrors ESCAPECRAFT's `overlayPaddingFor` term for term. Takes recorded at 1280 or wider
are unaffected, because at or above the cap the two readings agree.

**A take is skipped only if none of its parts is already in the media library.** The guard
asked about the take's primary part alone, so deleting the primary from the library and
re-sending the take from ESCAPECRAFT placed the webcam part on the timeline a second time
(re-adding it to the library was already idempotent by id). The question is now asked about
every part of the take, and asked before the first part is written.
