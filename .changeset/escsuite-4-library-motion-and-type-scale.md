---
'@escapesuite/artist': patch
---

The media library respects reduced-motion and its smallest text grows from 8px to 11px.
The upload progress bar's pulsing animation now turns off entirely for anyone who has
asked their OS for reduced motion, a finished upload's row fades out of the list instead
of popping away without warning, and the upload status text is now announced to screen
readers. The library's six ad-hoc font sizes (as small as 8px) are replaced by a small,
consistent scale: the media-type badge and the per-file metadata read at 11px, the
storage row at 11px, the small buttons at 12px, and the filename stays the scale's
largest size at 13px.
