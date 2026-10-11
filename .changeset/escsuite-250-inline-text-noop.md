---
'@escapesuite/artist': patch
---

Finishing an inline text edit without changing the text no longer adds an undo step, and clearing the text restores what was there instead of leaving an empty, nameless clip.

Committing the inline text editor used to write to the project every time, even with the same text, which left an undo entry that changed nothing, and an emptied editor renamed the clip to an empty string. An unchanged text is now ignored by the store, and a blank commit keeps the previous text and name.
