---
'@escapesuite/artist': patch
---

An export can run for minutes, and until now a screen-reader user heard nothing for the whole of it: the progress bar was a styled `<div>` with a width on it, and the "Encoding frame N/M" line and the percentage were text on screen and nothing more.

The bar is now a real `role="progressbar"` — labelled "Export progress", `aria-valuemin="0"`, `aria-valuemax="100"`, and an `aria-valuenow` rounded the way the percentage printed beside it already is, so a screen reader reads "42 percent" rather than spelling out a fraction.

Beside it there is one polite live region for the whole progress view. It speaks the first report of a run, then at most once every ten percentage points or every five seconds — whichever comes first, so a long encode that sits inside one band still says it is alive without a reader interrupting itself on every encoded frame — and always the completion sentence, which is the one report a throttle must never swallow. The words are the progress message with the percentage appended, so one announcement is a whole sentence on its own; the visible line keeps updating per frame and leaves the accessibility tree, so the same words are not met twice.
