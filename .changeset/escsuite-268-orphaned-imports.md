---
'@escapesuite/artist': patch
---

The media library can remove files imported in earlier sessions that no longer belong to any project, without touching ESCAPECRAFT recordings.

Before imports stopped being an undo step, undoing an import and then making another edit could leave that file's bytes in the browser's storage with nothing able to list or free them, short of clearing site data — which deletes every ESCAPECRAFT recording too. Beside Clear Unused and Clear All the media library now shows "N files from earlier sessions (X MB)" with a Remove button whenever such files exist. Nothing is removed until you click it and confirm; recordings, their companion tracks and anything this editor can still undo back to are never offered, and because another open editor tab could still be using these files, the confirmation says so.
