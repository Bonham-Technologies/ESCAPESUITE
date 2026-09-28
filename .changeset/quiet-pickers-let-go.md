---
"@escapesuite/craft": patch
---

Record always comes back, even when the browser never answers

If you started a recording and then left the share picker or the camera prompt sitting — or a camera or microphone driver simply never answered — ESCAPECRAFT used to sit on "preparing" forever, with a Record button that did nothing and nothing said about why; only a reload got the app back. It now stops waiting after a minute, says "The browser did not answer the capture request — try again." and returns to idle, and if the browser hands the capture over later it is released rather than left running behind an idle screen. Pressing Escape while a take is preparing also frees Record straight away instead of only when that outstanding request finally settles, so you can start the next take immediately — and the take you abandoned cannot come back and take the new one's place.
