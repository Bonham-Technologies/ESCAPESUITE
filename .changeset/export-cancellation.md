---
"@escapesuite/artist": minor
---

Add export cancellation support with AbortController

- Cancel button now properly stops in-progress exports instead of just hiding the dialog
- Export functions accept optional AbortSignal parameter
- Resources (video elements, blob URLs, encoders) are properly cleaned up on cancellation
- No error message shown for user-initiated cancellation
