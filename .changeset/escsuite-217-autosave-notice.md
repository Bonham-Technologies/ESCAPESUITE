---
'@escapesuite/artist': patch
---

The session autosave now tells you when it can't save

If your storage filled up, the editor kept trying to autosave your session in the background and quietly failing every time — the only record of it was a line in the browser console nobody but a developer would ever see. Now a failed autosave shows the same notice you'd see if you tried to import more media: "Storage quota exceeded. Remove some media to free up space." (or a generic "Your session could not be saved — storage may be full." for any other kind of failure). It shows up once per run of failures rather than on every debounced write, and it shows up again if saving starts failing a second time after a successful one in between.
