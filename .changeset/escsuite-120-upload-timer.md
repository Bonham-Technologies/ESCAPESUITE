---
"@escapesuite/artist": patch
---

The uploader's "remove from the list" timers are called off when it goes away

A finished upload stays in the uploader's progress list for two seconds and is then dropped by a timer. That timer was never cancelled, so closing the media panel — or, in the test suite, finishing a test — inside those two seconds left it armed against a component that no longer existed. In the app that was a state update on a gone component; in CI it surfaced as an unhandled error that failed a run with every test green. The timers are now tracked and cleared on unmount.
