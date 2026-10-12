---
'@escapesuite/artist': patch
---

Answering an old "Resume Previous Session?" prompt no longer deletes or replaces newer work saved in the same session by another window.

The prompt shows a saved session as it was when the prompt opened, and it can stay up for as long as you leave it. If the window that saved that session came back meanwhile, saved more work into it and closed again, Start Fresh used to delete that newer work and Restore used to bring back the older version over it. Both answers now look at the saved session again first. If it has changed, Restore shows you the newer version in the prompt instead ("That session changed in another window — here is the newer one."), and Start Fresh keeps it so it is offered again next time ("That session changed in another window, so it was kept for next time."). If it has been removed, neither answer has anything to act on and the prompt closes with "That session was removed in another window." A session that has not changed is answered exactly as before.
