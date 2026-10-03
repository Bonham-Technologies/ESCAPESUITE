---
'@escapesuite/craft': patch
---

Pressing Escape while a recording is being saved no longer throws the save away, and a save that finishes can no longer disturb the take you started after it

Stop a take and ESCAPECRAFT writes it to storage — repairing the container, reading the metadata, decoding the thumbnail and making two database writes — which on a long recording is a few seconds with "Saving…" in the header. Pressing Escape in that window used to be read as "cancel": the app went straight back to idle, the sources unlocked mid-write, and Record came back to life, all while the save was still running behind it. Start a second recording there and the first save's own "finished, back to idle" landed on the new take, which then carried on recording with the app insisting nothing was happening — no Stop button and no Cancel button, and clicking Record again started a third take over the top of it. Escape now does nothing at all while a take is saving, the way it already does nothing when there is nothing to cancel, and a save's completion is tied to the take it saved, so a finished save can only ever settle its own take's state — whatever happened in the meantime. A save that fails still says so, and the recording still lands in your library either way.
