# @escapesuite/plan

## 2.15.26

### Patch Changes

- 9021911: Added a "Skip to main content" link to the hub. It is the first thing Tab
  reaches on every page, so a keyboard user no longer has to cross the logo,
  the GitHub link and the theme toggle before getting to the page itself. It
  stays out of sight until it is focused, and activating it puts focus on the
  main content.

## 2.15.24

### Patch Changes

- Updated dependencies [cc1c8f6]
  - @escapesuite/shared@1.4.4

## 2.15.21

### Patch Changes

- Updated dependencies [a91f1e3]
  - @escapesuite/shared@1.4.3

## 2.15.20

### Patch Changes

- 44a3b84: The download buttons now fetch the latest offline build directly. "Download the
  offline build" used to point at GitHub's bare "latest release" listing, which
  can resolve to any per-package release a version bump creates — including one
  with no offline build attached at all, for as long as it takes the next real
  build to land. The open-source section's button is now two per-app buttons,
  "Download ESCAPECRAFT" and "Download ESCAPEARTIST", each pointed at a stable
  asset URL that always resolves to that app's latest build; the hero keeps a
  secondary "All downloads" link to the GitHub releases page for anyone who
  wants to browse everything instead.

## 2.15.19

### Patch Changes

- 247f24c: Deleted two stray files from `apps/plan/public/` that `pnpm build:deploy` was copying straight onto the live `escapesuite.io` origin: `CNAME` (`escapesuite.io`), a leftover from a GitHub Pages era whose content contradicted the app's own canonical-host comment, and `og-image.png` (143 KB), an unreferenced social-share image that every page replaced with `og.png` some time ago. Neither file has any reference left anywhere in the app. Both paths now fall through to the same SPA page any unknown URL on this site does, instead of serving the stray file's own bytes.
- Updated dependencies [247f24c]
  - @escapesuite/shared@1.4.2

## 2.15.12

### Patch Changes

- Updated dependencies [0a364ea]
  - @escapesuite/shared@1.4.1

## 2.12.47

### Patch Changes

- 443d90c: The two "Download the offline build" links on the landing page now fire an
  "Offline Build Downloaded" analytics event (hosted build only, same as every
  other event) before the browser follows them to the GitHub release. Previously
  the single most interesting conversion on the page — someone leaving for the
  offline build — was invisible in the dashboard.

## 2.7.0

### Patch Changes

- Updated dependencies [7ce6894]
  - @escapesuite/shared@1.4.0

## 2.4.2

### Patch Changes

- 3b0fe5f: analytics mounts through the shared build-mode gate
- Updated dependencies [3b0fe5f]
  - @escapesuite/shared@1.3.3

## 2.3.11

### Patch Changes

- Updated dependencies [236a7dc]
  - @escapesuite/shared@1.3.2

## 2.3.10

### Patch Changes

- Updated dependencies [50491ce]
  - @escapesuite/shared@1.3.1

## 2.2.0

### Minor Changes

- 90969e4: Host embedding protocol for apps running inside another page (#320):
  
  - ARTIST posts `EXPORT_COMPLETE { blob, format, name }` to the parent window after a successful export (the download still happens).
  - CRAFT's "Send to Editor" posts `SEND_TO_EDITOR { id }` to the parent when embedded instead of opening `/artist/`; the host navigates to its own editor URL with `?loadVideo=<id>`. Existing embedders must listen for this message.
  - ARTIST URL parameters: `?suppressRestore=1` (no "Resume Previous Session?" prompt, and no session autosave in that session), `?title=<name>` (initial project name), `?hostOrigin=<origin>` (postMessage target and inbound origin filter; recommended for production hosts).
  - ARTIST ignores inbound messages that do not come from its parent window; the `GET_STATE` reply now returns live state.
  - The hosted deployment (escapesuite.io) now sends `Content-Security-Policy: frame-ancestors 'self'` (#321).

### Patch Changes

- Updated dependencies [90969e4]
  - @escapesuite/shared@1.3.0

## 2.1.0

### Minor Changes

- b9f8928: - Moved CI to a Node 24 baseline and cleared the outstanding `fast-uri` security advisories via a pnpm override.
  - MP4 export now works correctly above 1080p, falling back to H.264 Level 5.1 for 4K/1440p sources; headless render metadata is now accurate, and missing source files fail loudly instead of silently producing a broken export.
  - Shipped headless render bundle v2: sources stream in via file input and results stream out via download, with metadata probing for accurate render info.
  - Accessibility fixes across ESCAPECRAFT and ESCAPEARTIST, plus new demo media in the README.

### Patch Changes

- Updated dependencies [b9f8928]
  - @escapesuite/shared@1.2.1

## 1.2.0

### Minor Changes

- Add standalone licensing system with pre-licensed downloads

  ### ESCAPEPLAN

  - **Pre-Licensed Downloads**: Server-side license injection - users download HTML with license already embedded
  - **Downloads Page**: "Download (Pre-Licensed)" button for instant-use downloads, "Generic" for manual key entry
  - **Edge Functions**: `get-licensed-download` for personalized builds, `get-user-licenses` for portal, `send-license-email` for purchase emails
  - **Database Migrations**: `license_activations` table, `downloads` storage bucket

  ### ESCAPECRAFT & ESCAPEARTIST

  - **License Input Modal**: Runtime license key entry UI for standalone builds
  - **Machine Hash**: Browser fingerprinting for activation tracking
  - **Dashboard Link**: Hidden in standalone mode (no dashboard exists)
  - **Analytics**: Removed from standalone builds (runs offline)

  ### Shared Package

  - **LicenseInputModal**: Reusable license entry component
  - **machineHash**: Cross-browser machine identification
  - **Bootstrap**: Analytics excluded from standalone mode

### Patch Changes

- Updated dependencies
  - @escapesuite/shared@1.2.0

## 1.1.1

### Patch Changes

- 0020d0e: Extract analytics trackEvent to @escapesuite/shared package

  - Add @escapesuite/shared/analytics module with shared trackEvent function
  - All apps now import trackEvent from shared package
  - App-specific analytics events remain in each app

- d5477d3: Extract Sentry configuration to @escapesuite/shared package

  - Add @escapesuite/shared/sentry module with shared initSentry function
  - Support product tagging via options parameter
  - All apps now import from shared package with app-specific product tags

- 27869d5: Extract theme system to @escapesuite/shared package

  - Add @escapesuite/shared/theme module with storage-agnostic theme utilities
  - Add ThemeToggle component to shared package
  - All apps now use the shared theme module with app-specific storage adapters
  - Reduces ~500 lines of duplicated theme code

- Updated dependencies [0020d0e]
- Updated dependencies [246a63c]
- Updated dependencies [8c64a95]
- Updated dependencies [dc3194d]
- Updated dependencies [d5477d3]
- Updated dependencies [08422a9]
- Updated dependencies [27869d5]
- Updated dependencies [4fb6bd3]
- Updated dependencies [33adadf]
  - @escapesuite/shared@1.1.0

## 1.1.0

### Minor Changes

- b633d3e: Add Changesets for version and release management

  - Automated version bumping and changelog generation
  - GitHub Action creates "Version Packages" PR when changesets accumulate
  - All main apps (plan, craft, artist) version together

### Patch Changes

- 0b2af1f: Dependency cleanup and version synchronization

  - Remove unused gh-pages dependency and deploy scripts from PLAN
  - Sync @clerk/clerk-react to ^5.59.2 across all apps
  - Sync React to ^19.2.3 across all apps
  - Standardize TypeScript constraint to ~5.9.3 (patch-only updates)
