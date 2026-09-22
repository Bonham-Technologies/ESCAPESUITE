---
'@escapesuite/craft': patch
---

Stop the endless media-error loop every saved recording left behind. From the first recording
you saved, the tab kept a CPU core busy until you reloaded the page — a fresh recording, the
preview and the rest of the app all had to share what was left.

`thumbnailGenerator`'s cleanup emptied the `<video>`'s `src` while its own `onerror` was still
attached, and an empty `src` is a load failure rather than a release: the browser answers it
with an `error` event. That went straight back into the cleanup that emptied `src`, which
emptied it again — so each saved take left a detached element spinning error → cleanup → error
at roughly 44,500 iterations a second for the rest of the session. The handlers now come off
before the element is released, and the release uses `removeAttribute('src')` + `load()`, which
fires nothing at all.
