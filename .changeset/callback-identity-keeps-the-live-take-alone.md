---
"@escapesuite/craft": patch
---

A late callback from a cancelled take can no longer tear down or save over the one that replaced it

The recorder's five state-changing callbacks used to act on whatever the recorder, tickers and streams the refs held when they fired, not on the recorder they were built for. A recorder cancelled and disposed can still report a dead encoder or flush a last chunk afterwards (rare, not impossible), and if a new take had already started by then, that late `onError` disposed the live recorder and stopped its streams under it, and a late `onStop` — past `cancelledRef`, which a start resets — would have saved the old take's blob as the new one's. Each callback now closes over the exact recorder instance it was created for and returns early once it is no longer the current one, the same identity the start path already carries with its attempt token — which also means a recorder's own late `onStop`, arriving after its own `onError` already disposed it and reported the take as failed, is dropped rather than saved as a success.
