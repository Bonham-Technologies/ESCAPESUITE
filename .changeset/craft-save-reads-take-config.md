---
'@escapesuite/craft': patch
---

The Sources and Webcam Overlay panels now stay locked until a finished take is done saving, and the save itself only ever uses the settings that take was actually recorded with

Finishing a take used to leave the Sources panel and the Webcam Overlay panel unlocked while "Saving…" was still on screen. Toggling System Audio or moving the webcam overlay during that window looked like it could still change the take being written — a control that appears live when it is not. Both panels are now disabled for as long as a take is being saved, the same as while it records, and `System Audio`, the webcam toggle and the webcam overlay's position/size/shape are captured once when a take starts and carried through to the save, rather than read again from whatever the panels show by the time the save runs.
