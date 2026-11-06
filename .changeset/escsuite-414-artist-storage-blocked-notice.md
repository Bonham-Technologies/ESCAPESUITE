---
'@escapesuite/artist': patch
'@escapesuite/shared': patch
---

When the browser won't let ESCAPEARTIST store anything (site data blocked, Firefox's "Never remember history", or storage turned off for an embedded editor), the media library now says so as soon as the editor opens: "Your media library could not be opened — storage may be blocked in this browser. Allow this site to store data, then reload." The notice stays up. A file you then try to import says "Storage is blocked in this browser, so this file could not be imported" instead of a technical error message, and the editor no longer shows the misleading "storage may be full" warning when it can't save your session.
