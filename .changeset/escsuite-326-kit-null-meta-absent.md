---
'@escapesuite/headless-artist': patch
---

A bundle or manifest source whose duration, width or height is null is rendered instead of refused

A `null` in a source's `meta` for its duration, width or height now counts as not given, the way it already does for a name or type, and the kit works the value out from the video. A value that is present and wrong, such as a negative or a string, is still refused by name.
