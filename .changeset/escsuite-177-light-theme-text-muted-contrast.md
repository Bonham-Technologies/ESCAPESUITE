---
'@escapesuite/craft': patch
---

Fixed a WCAG AA contrast failure in the light theme's muted text colour

The light theme's `--text-muted` token, used for an unavailable source row's label and the "no system audio" meter label, measured 3.74:1 against the sidebar background — under the 4.5:1 minimum, and a real accessibility defect regardless of browser. It only showed up as a test failure in Firefox because Chromium's run of the same scenario happened not to mark that particular row as unavailable; a cross-browser accessibility sweep caught it. The token is darkened to clear AA with headroom, and a unit test pins the measured contrast ratio so neither theme can regress silently again.
