---
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Follow-up fixes from the coverage program:

ESCAPECRAFT:

- Closing or navigating away from the recorder mid-countdown or mid-take left the countdown and duration timers ticking and the screen, webcam and microphone still live; everything is now released as the recorder goes away.

ESCAPEARTIST:

- Ctrl/Cmd + "=" and Ctrl/Cmd + "-" zoomed the timeline and swallowed the browser's own page zoom; they now reach the browser, while plain "+", "=" and "-" still zoom the timeline.
- Re-adding media the library already holds, unchanged — as a restored session does — recorded an undo step that undid nothing.
