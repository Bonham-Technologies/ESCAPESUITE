---
'@escapesuite/artist': patch
---

Opening a saved project no longer resurrects a take you deleted in ESCAPECRAFT (ESCSUITE-151)

Loading a `.veditor` project file wrote every source it carried back into the shared database exactly as saved, including the fields that mark a file as an ESCAPECRAFT recording. If you had deleted a take in ESCAPECRAFT after saving a project that used it, reopening that project in ESCAPEARTIST put the take straight back into ESCAPECRAFT's recordings list — bytes the project still needed, resurrected under an identity ESCAPECRAFT no longer recognised as live. A load now only ever takes that identity from what is already in the shared database — clearing it outright for a source that genuinely isn't there — while everything else about a source, present or not, is still restored from the file being reopened exactly as before.
