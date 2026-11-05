<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# ESCAPEPLAN (apps/plan)
- React Router for client-side routing
- Landing page & legal pages only — no accounts, no backend
- In production: serves CRAFT at `/craft/` and ARTIST at `/artist/`
- `/limitations` (ESCSUITE-402): "Known limitations, and how to check nothing leaves". The list is
  data in `src/pages/Limitations/limitations.ts`, each entry with its source doc, file, ticket or
  ruling (a unit test fails on an entry with none); the page reuses `Legal.module.css` and links
  to `apps/e2e/tests/production/network-silence.spec.ts`. Linked from the footer and the README.
  Served in the combined deploy by `vercel.json`'s SPA catch-all, like `/privacy`. Change an
  entry when its source changes; the analytics wording is the owner's to approve.
