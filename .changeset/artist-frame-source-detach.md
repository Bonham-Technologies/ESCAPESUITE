---
'@escapesuite/artist': patch
---

Detach a video frame source's `onloadeddata` and `onerror` before disposing it. `create()` left
both attached for the element's whole life, and `dispose()` empties `src` — which the browser
answers with an `error` event, handing it to a handler that revoked an already-revoked object
URL and rejected a long-settled promise. Both were no-ops, so nothing misbehaved; but it is the
same shape as the ESCAPECRAFT cleanup that spun error → cleanup → error for the life of the
page, one edit away from doing the same thing here.
