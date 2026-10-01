---
'@escapesuite/artist': patch
---

Waveforms keep their detail when you zoom in. Before this, a clip's waveform was always
resampled to the same capped array regardless of zoom — so a 60-second clip showed the exact
same 2,000 distinct peaks whether you were zoomed all the way out or all the way in, with the
zoomed-in view just stretching those same peaks across a wider box (and, past a point, visibly
smearing a fixed-size bitmap over a much larger canvas). Now the waveform resamples whatever
slice of the clip is actually scrolled into view, so zooming in and scrolling reveal real
additional detail instead of a wider version of the same blur. Scrolling a zoomed-in clip is
also lighter on low-spec machines than the first version of this fix: the visible window is
quantised to a 64px grid so a one-pixel scroll costs nothing, the amount of detail requested
never exceeds what the clip's own audio data actually contains, the scroll handler itself
updates at most once per animation frame, and resampled buffers are reused rather than
reallocated as you scroll.
