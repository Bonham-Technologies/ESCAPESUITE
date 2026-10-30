---
'@escapesuite/artist': patch
---

The Ripple Edit tool now closes the gap when you trim a clip's start, as it already did for its end. Dragging a clip's start edge right with Ripple used to trim the head and leave a hole in front of the clip, which came out as black and silence in the export. Now the clip keeps its place and every later clip on its track moves up by the amount trimmed. Dragging the start edge left reveals more of the head and pushes the later clips back. Linked clips from a separate-tracks recording ripple together, as they do for end trims.
