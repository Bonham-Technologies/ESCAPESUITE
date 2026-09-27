---
'@escapesuite/craft': patch
---

Cancelling a take while the screen-share or camera prompt is still up now really stops it

Pressing Escape — or closing the recorder — while ESCAPECRAFT was still waiting for the capture left the browser's sharing bar and the camera light on for the rest of the session, behind a UI that said idle: the cancel had nothing to release yet, and the request that arrived afterwards went on to build the whole take anyway. It now releases whatever the request handed back and builds nothing on top of it — no preview, no compositor, no recorder and no AudioContext — so repeated cancels no longer use up the browser's supply of them and leave later takes unable to start. Two fast clicks on Record (or two presses of R) also start one take rather than two.
