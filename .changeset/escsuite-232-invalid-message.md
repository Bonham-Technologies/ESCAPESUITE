---
'@escapesuite/artist': patch
---

A malformed message from a host now gets an error reply instead of silence

A host that sends a malformed message — LOAD_VIDEO with no URL, SET_THEME with an unknown theme — now gets an ERROR reply with code INVALID_MESSAGE naming the field, instead of silence.
