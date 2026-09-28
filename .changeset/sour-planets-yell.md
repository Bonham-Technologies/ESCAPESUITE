---
"@escapesuite/craft": patch
---

The microphone and system meters go quiet the moment a recording stops

The level meters used to keep showing whatever they last read once a take
ended — a mic bar frozen mid-swing, a system-audio bar stuck wherever it was
— until the next take's own sound moved it again. They now go back to zero
the instant a recording stops, however it stopped, so nothing left over from
one take can be mistaken for something happening in the next.
