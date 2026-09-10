---
"@escapesuite/artist": minor
"@escapesuite/craft": minor
"@escapesuite/plan": minor
---

Host embedding protocol for apps running inside another page (#320):

- ARTIST posts `EXPORT_COMPLETE { blob, format, name }` to the parent window after a successful export (the download still happens).
- CRAFT's "Send to Editor" posts `SEND_TO_EDITOR { id }` to the parent when embedded instead of opening `/artist/`; the host navigates to its own editor URL with `?loadVideo=<id>`. Existing embedders must listen for this message.
- ARTIST URL parameters: `?suppressRestore=1` (no "Resume Previous Session?" prompt, and no session autosave in that session), `?title=<name>` (initial project name), `?hostOrigin=<origin>` (postMessage target and inbound origin filter; recommended for production hosts).
- ARTIST ignores inbound messages that do not come from its parent window; the `GET_STATE` reply now returns live state.
- The hosted deployment (escapesuite.io) now sends `Content-Security-Policy: frame-ancestors 'self'` (#321).
