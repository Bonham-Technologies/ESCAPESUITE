---
'@escapesuite/artist': patch
---

The File menu works from the keyboard. It always looked like a menu to a
screen reader — the markup said so — but it was four plain buttons behind that
label, so arrow keys did nothing and an accessibility audit of the open menu
failed outright. Now opening it drops you on the first item, the arrows move
between them (wrapping, and skipping anything greyed out), Home and End jump to
the ends, Enter and Space pick, and Escape shuts it and puts you back on the
File button without disturbing whatever you had selected on the timeline.
