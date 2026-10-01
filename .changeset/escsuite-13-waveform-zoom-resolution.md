---
'@escapesuite/artist': patch
---

Waveforms keep their detail when you zoom in. Before this, a clip's waveform was always
resampled to the same capped array regardless of zoom — so a 60-second clip showed the exact
same 2,000 distinct peaks whether you were zoomed all the way out or all the way in, with the
zoomed-in view just stretching those same peaks across a wider box (and, past a point, visibly
smearing a fixed-size bitmap over a much larger canvas). Now the waveform resamples whatever
slice of the clip is actually scrolled into view, so zooming in and scrolling reveal real
additional detail instead of a wider version of the same blur.
