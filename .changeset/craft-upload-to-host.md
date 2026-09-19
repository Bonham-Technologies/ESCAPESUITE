---
'@escapesuite/craft': minor
---

Recordings can be uploaded to an embedding host

Every row in the recordings library gains an "Upload to host" button when
ESCAPECRAFT is running inside an iframe: it posts `UPLOAD_RECORDING
{ id, name, blob }` to the parent window, handing over the stored blob itself
by structured clone. A host that cannot reach the shared IndexedDB no longer
has to. Standalone ESCAPECRAFT never draws the button — there would be no one
to post to — and nothing leaves the machine either way.
