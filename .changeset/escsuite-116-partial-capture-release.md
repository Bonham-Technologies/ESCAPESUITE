---
"@escapesuite/craft": patch
---

The "sharing your screen" bar no longer stays up after ESCAPECRAFT gives up waiting for the camera or microphone

If you shared your screen and then left a camera or microphone prompt sitting unanswered — or a driver simply never answered it — ESCAPECRAFT already gave up after a minute and returned you to idle, but the screen share you'd already granted kept running in the background until that stalled prompt was eventually dealt with, which could be never. It now stops the screen share (and anything else already granted) the moment it gives up, not whenever the stalled prompt finally settles — including a prompt answered well after the minute is up, and including a take you cancelled yourself while it was still waiting.
