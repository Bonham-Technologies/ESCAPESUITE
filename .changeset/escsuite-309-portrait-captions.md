---
'@escapesuite/artist': patch
---

Imported captions now fit the frame on a portrait project

A caption file imported into a portrait project, such as 1080×1920, ran off both edges of the picture because the text size followed the frame's height and the line length ignored its width. Captions are now sized from the shorter side and wrapped to the columns the width allows, so landscape and square projects look exactly as before.
