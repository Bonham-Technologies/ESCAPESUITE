---
'@escapesuite/craft': patch
---

Cancelling the share picker now says so

If you clicked "Start recording" and then cancelled the screen-share picker, or refused a camera or microphone prompt, you used to get a generic "The recording could not be started." — the same sentence as any other failure, with no hint that nothing went wrong on the app's end. You now get "The browser refused the capture — nothing was recorded.", because that notice was already written and wired up, but a wrapping bug kept it from ever firing. Refusing a device that genuinely is not there (no camera, no microphone) still gets the generic sentence — that is a separate case this fix leaves alone.
