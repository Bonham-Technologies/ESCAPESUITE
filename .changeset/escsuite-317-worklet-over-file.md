---
'@escapesuite/craft': patch
---

The offline ESCAPECRAFT now records audio through the AudioWorklet when opened from disk

The downloaded offline ESCAPECRAFT now records audio through the AudioWorklet in Chrome, as the hosted one does. Opened from a file, Chrome refused the worklet's script and every take quietly used the older, drift-prone audio path; the script is now offered a second way when the first is refused, and the console says which one loaded.
