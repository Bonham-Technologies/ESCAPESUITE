---
"@escapesuite/craft": minor
---

Add flexible download format options and recording improvements

**New Features:**
- Three download format options: WebM (Instant), WebM (Compatible), and MP4 (Universal)
- Help modal with recording tips and best practices
- MP4 export using WebCodecs + Mediabunny (H.264 + AAC)

**Improvements:**
- Improved screen capture source selection (excludes self-capture)
- Fixed download dropdown positioning
- Added track ended event handlers for graceful recording stops
- Better WebM metadata using webm-duration-fix library

**Download Options:**
- WebM (Instant): Fast download, works in browsers and VLC
- WebM (Compatible): Re-encoded for Windows Media Player compatibility
- MP4 (Universal): H.264 + AAC for maximum compatibility everywhere
