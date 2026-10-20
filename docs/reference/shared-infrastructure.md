<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Shared Infrastructure
- **pnpm workspaces**: Efficient dependency management with shared packages
- **Turborepo**: Cached builds, parallel execution, smart rebuilds
- **IndexedDB Database**: CRAFT and ARTIST share `video-editor-db` for seamless data transfer.
  The connection is shared through one cached open in `getDB()` (`packages/shared/src/storage`) and
  reopens itself after the browser closes it (Clear site data, an eviction), closing itself for a
  version change or a delete from another tab rather than blocking it (ESCSUITE-226)
- **Single-file Builds**: `vite-plugin-singlefile` inlines all assets into one HTML file,
  but not a Web Worker — ESCAPEARTIST's `decodeWorker` needs a second mechanism
  (`isSingleFileBuild`, `apps/artist/singleFileBuild.js`, read by `apps/artist/vite.config.ts`)
  that inlines it as a blob URL for the headless and standalone targets specifically (both run
  from `file://`, where Chromium blocks a separate worker script) and fails the build if any
  `.js` file survives inlining; the hosted build keeps the worker as an ordinary fetchable
  chunk. ESCSUITE-153: before this predicate existed, the standalone build checked only
  `VITE_HEADLESS` here and shipped an un-inlined `decodeWorker-*.js` the release never attached.
  The standalone HTML also carries the hosted deployment's `rel="canonical"` and `og:url`/
  `og:image` tags, pointing at `https://www.escapesuite.io` — nothing in the single-file bundle
  requests either URL, so this is harmless to the offline guarantee (ESCSUITE-177 n2), just an
  odd-looking artefact of reusing the same `index.html` template for both targets.
- **Shared dialog behaviour**: `useDialogBehaviour` (`packages/shared/src/hooks`, imported
  as `@escapesuite/shared/hooks`) is the single modal keyboard implementation — initial
  focus, the Tab/Shift+Tab trap, Escape-to-close and focus restored to the opener — used by
  CRAFT's two modals and all five of ARTIST's (export, shortcut sheet, project-load, session
  restore, the resolution-change confirm). Escape's *meaning* is per dialog, not inherited: the
  hook calls whatever it is handed, and ARTIST's session-restore prompt hands it a no-op because
  declining discards this tab's own (or the legacy) saved session — another tab's is left where it is
  since ESCSUITE-306, because the tab may only be discarded, not gone. See each app's CLAUDE.md
  "Dialogs" note
- **Shared error boundary**: `ErrorBoundary` (`packages/shared/src/components`), available as
  `@escapesuite/shared/components` for a host app, is the one React error boundary for all three
  apps. `bootstrapApp()` mounts it around `<App />` for CRAFT and ARTIST; ESCAPEPLAN, which
  builds its own root, mounts it itself in `main.tsx` inside `<BrowserRouter>` (so Reload keeps
  the route) and around `<App />`, with no `onError` (ESCSUITE-219). A
  render-time throw anywhere below it shows one minimal,
  accessible fallback panel instead of unmounting the whole app to a blank page, and calls an
  optional `onError(error, info)` — the one hook a host app has for releasing anything a crash
  would otherwise leave dangling. CRAFT's disposes a live recorder; ARTIST's is a documented
  no-op; PLAN passes none. See each app's CLAUDE.md

  would otherwise leave dangling. CRAFT's disposes a live recorder; ARTIST's stops an export in
  flight through `disposeLiveExport()` (ESCSUITE-220). See each app's CLAUDE.md
