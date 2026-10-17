---
'@escapesuite/artist': patch
---

Trimming the second half of a split text, shape or image clip keeps the length you dragged to

Splitting a text overlay, a shape or an image and then trimming the second half used to leave it shorter than the drag asked for — a 10-second title split at 4 seconds and trimmed in by one second came out one second long instead of five, and trimming further could give it a negative length that stopped the project reopening. Both halves of such a clip now start clean, a trim always writes the length you dragged to, and a project saved with the old wrong numbers on an overlay is put right when it is opened, with one note in the console.
