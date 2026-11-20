---
'@escapesuite/artist': patch
---

Remove silences: Minimum gap now starts at 0.1 s, so a gap of 0 can no longer list and cut thousands of 10 ms pauses; the field says "Enter a number from 0.1 to 60." and Remove all waits until every field holds a valid number. When more than 500 pauses are found, the list shows the first 500 and the summary says how many were found; Remove all still cuts every one. Typing in the fields stays quick on an hour-long recording.
