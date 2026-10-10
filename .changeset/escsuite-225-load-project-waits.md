---
'@escapesuite/artist': patch
---

A host's LOAD_PROJECT no longer gets replaced by a restored session

A host's `LOAD_PROJECT` that arrives while the editor is still asking whether to resume the previous session is applied once that question is answered, instead of being replaced by the restored session.
