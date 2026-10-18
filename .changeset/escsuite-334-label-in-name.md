---
'@escapesuite/plan': patch
'@escapesuite/craft': patch
'@escapesuite/artist': patch
---

Three controls now carry their visible text in their accessible name (WCAG 2.5.3 Label in Name, ESCSUITE-334), which axe-core 4.14 checks by default. In ESCAPEPLAN, the header's logo link reads "ESCAPE Suite" with a real space between the two words, so its name "ESCAPE Suite Home" contains it. In ESCAPECRAFT, each recording row's M4A button is named "Download <name> as M4A audio" instead of "... as audio (M4A)", because a parenthesised "(M4A)" is not the word "M4A" the button shows. In ESCAPEARTIST, the timeline's Add Track button is named by its visible "Add Track" instead of a different "Add new track"; the title stays as a description. A speech-input user can now activate each control by saying what it shows.
