---
'@escapesuite/artist': patch
---

An export no longer fails with "cannot read this file frame by frame" just because the computer is busy. A seek that was slow but still working was counted as a broken file; it now gets two more seconds to land before the export gives up.
