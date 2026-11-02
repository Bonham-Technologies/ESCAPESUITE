<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Build Configuration
- `vite-plugin-singlefile`: Builds entire app into a single HTML file (all assets inlined)
- Target: ESNext, no code splitting
- `build:standalone` produces an offline single-file build for air-gapped use
- **The standalone `dist/` must be exactly `index.html`** — `apps/e2e/tests/standalone/
  dist-single-file.spec.ts` (ESCSUITE-153) asserts this for both CRAFT and ARTIST, and CRAFT
  has no `public/` directory for that reason: Vite's `publicDir` copies anything there into
  `dist/` verbatim, un-inlined, and `standalone-release.yml` attaches only the HTML to the
  release. A pre-existing `public/vite.svg` (unreferenced Turborepo-migration scaffold — this
  app's favicon is an inline `data:` URI in `index.html`) was deleted for exactly this reason;
  a future legitimate static asset (an icon, a `robots.txt`) needs a different route into the
  bundle, not `public/`
- **App version on screen** (ESCSUITE-369): `vite.config.ts` defines `__APP_VERSION__` from
  this app's `package.json` (typed in `src/vite-env.d.ts`), in dev, the hosted build, the
  standalone file and the tests alike. The Recording Tips dialog's last line reads
  "ESCAPECRAFT vX.Y.Z", and "ESCAPECRAFT vX.Y.Z · offline file" in the standalone build
  (`appVersionLabel` in `@escapesuite/shared/config`). Ask a reporter for that line.
