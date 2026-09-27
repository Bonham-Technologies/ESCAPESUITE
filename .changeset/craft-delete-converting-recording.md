---
'@escapesuite/craft': patch
---

Deleting a recording while it is converting to MP4 or M4A now cancels that conversion, instead of leaving every other recording's MP4/M4A buttons stuck on "one conversion at a time" for however long the orphaned conversion still needed. A conversion that finishes anyway, just after its recording was deleted, no longer downloads a file named after a recording that's already gone. Also: deleting a recording now revokes its thumbnail's memory (and reloading the library revokes the old thumbnails first), and deleting a take with several files (camera, microphone, screen) now deletes its companion files first and the main recording last, so a failure partway through can no longer leave an orphaned file behind — you'll see a message if any part couldn't be deleted.
