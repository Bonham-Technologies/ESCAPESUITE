---
'@escapesuite/artist': patch
---

The selection box, the click target and a keyframe drag now follow the picture through a transition

During a transition the clip arriving and the clip leaving ignore their own Animate In / Animate Out preset, because the transition is already doing that job. The selection box, the clip you can click on, the marquee and the point a keyframe drag starts from did not know that, so a clip with a slide or scale preset on that side was outlined — and picked up — where it used to be rather than where it is, and a drag made there moved the clip by the difference. All four now read the clip exactly as the preview draws it.
