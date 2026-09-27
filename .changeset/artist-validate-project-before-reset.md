---
'@escapesuite/artist': patch
---

Opening a malformed project file no longer empties the editor before reporting the failure

Opening (or dropping) a `.veditor` file whose timeline was missing its tracks or clips used to
clear the current project first and only then discover the file could not be read — the
"Failed to load project" notice appeared over a blank, if undo-able, editor. A bad file is now
checked before anything is reset, so a failure leaves the project exactly as it was and names
what was wrong with the file. The same check now guards a host's `LOAD_PROJECT` message: a
malformed payload gets an `ERROR` reply instead of either being silently ignored or throwing
partway through.
