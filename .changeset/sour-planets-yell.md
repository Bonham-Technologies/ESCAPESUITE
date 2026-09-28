---
"@escapesuite/craft": patch
---

The microphone and system meters go quiet the moment a recording stops

The level meters used to keep showing whatever they last read once a take
ended — a mic bar frozen mid-swing, a system-audio bar stuck wherever it was
— until the next take's own sound moved it again, including when a take was
cancelled or Escape was pressed rather than stopped normally. They now go
back to zero the instant a take ends, however it ended — stopped, cancelled,
or the app going away mid-take — so nothing left over from one take can be
mistaken for something happening in the next.
