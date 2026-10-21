<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Integration with ESCAPEARTIST
- Both apps share `video-editor-db` IndexedDB database
- Recordings stored with `source: 'recording'` and `recordedAt` timestamp
- "Send to Editor" opens ESCAPEARTIST with `?loadVideo=<id>` parameter — the id of a take's
  **primary** part, whichever row was clicked, *unless* that row's own primary is no longer in
  CRAFT's library (its own id then, ESCSUITE-145): an orphaned companion — its primary deleted
  from ARTIST's media library elsewhere — hands over its own id rather than one that resolves to
  nothing, and ARTIST imports it alone rather than answering "Recording not found". Given a
  primary, ARTIST resolves the siblings and places every part of the take on the timeline in one
  undo step; see `apps/artist/CLAUDE.md`'s "A handed-over take is several files" for the detail
- Same-origin deployment (Vercel) enables seamless data sharing
