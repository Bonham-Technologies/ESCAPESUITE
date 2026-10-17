---
'@escapesuite/artist': patch
---

Export no longer freezes while loudness is measured

Measuring the loudness of a long mix used to lock the editor for seconds before any frame was encoded — a ten-minute project could hang the tab for three seconds or more, Cancel did nothing and the dialog said nothing. The measurement now runs in short steps: the dialog shows "Measuring loudness…" and its progress, Cancel stops the export within a moment, and the measured loudness, the gain and every sample of the normalised sound are exactly what they were before.
