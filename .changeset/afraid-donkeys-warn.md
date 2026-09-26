---
"@escapesuite/artist": patch
---

Undo stays one step per gesture even when the first write of a gesture is refused. Dragging a slider, a preview handle or a clip edge whose track was locked and then unlocked mid-gesture now leaves exactly one undo entry — the one that takes the clip back to where the gesture found it — instead of leaving none and letting the next Ctrl+Z undo the edit before it; and dropping a clip on a row that will not take it now moves the clip nowhere at all, rather than sliding it along its old row.
