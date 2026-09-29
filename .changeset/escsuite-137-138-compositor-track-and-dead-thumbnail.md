---
'@escapesuite/craft': patch
---

A composited picture-in-picture recording no longer leaves a hidden capture running after you stop it

Stopping a screen-plus-webcam (picture-in-picture) take released the camera and microphone, but the canvas that combined them into one picture kept quietly capturing in the background for the rest of the session — one for every such take. It is now released the moment the take stops, the same as everything else the recording used.
