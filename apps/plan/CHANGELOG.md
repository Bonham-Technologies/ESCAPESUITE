# @escapesuite/plan

## 2.20.0

### Patch Changes

- 6204cbb: The Privacy Policy now lists exactly what the hosted site's analytics records: the page path (never anything after a ? or #), the site that sent you, your browser, operating system and device type, and your approximate city. It explains that Vercel works out the location from your IP address and says it does not store it.
- abda84d: The Known limitations page now covers two more browser limits: Transcribe to captions in ESCAPEARTIST (it works in browsers with on-device speech recognition, today Chrome-family browsers on a computer, in real time, with a speech language pack your browser may download and no audio leaving your device) and Float controls in ESCAPECRAFT (only in browsers with Document Picture-in-Picture, such as Chrome and Edge, and not when embedded in another page).
- e7b0155: The ESCAPEARTIST card on the home page now mentions removing silences and adding captions. ESCAPECRAFT's Recording Tips explain Float controls, the always-on-top window with the timer and record, pause and stop buttons, in browsers that can open it.
- 95549cf: A mistyped or out-of-date link on escapesuite.io now shows a "Page not found" page, with links to the home page, the recorder and the editor, instead of quietly showing the home page. Search engines are told the page does not exist, so they stop listing made-up addresses as copies of the home page.

## 2.19.0

### Patch Changes

- eef71d2: You can now check an offline download before it goes onto your network. Every release lists each file's SHA-256 checksum in `SHA256SUMS.txt` and carries a GitHub build-provenance attestation for each file. Under the download buttons on escapesuite.io, "verify your download" links to the steps for Linux, macOS and Windows.
- 76f8eda: The hub has a new Known limitations page, linked from the footer. It lists what ESCAPE Suite cannot do yet (MP4 without sound in Firefox, system audio in Chrome and Edge only, Safari exports that need the tab in front, the 3-hour export limit, browser storage limits, Safari Private Browsing, no phones or tablets), says exactly what the hosted site's analytics send, and shows how to check for yourself that nothing else leaves your device.
- 6051aba: The hosted site's analytics no longer send the page's query string. When a website embedded ESCAPECRAFT or ESCAPEARTIST, anything it put in the app's address (a video's address, a project title, a whole project, its own address or a window name) used to be sent to Vercel Web Analytics with every page view and event. Each record now carries only the page's path, such as `/artist/`. The offline build is unchanged: it sends nothing at all.
- 2eec2be: Links on the Privacy Policy and Terms of Service pages are now underlined and drawn in the lighter link colour, so they are easy to read and easy to tell apart from the text around them in both the dark and light themes.
- 05deacd: Licence changed from MIT to the Apache License 2.0 from this release; earlier releases remain MIT. The site footer, home page, Terms of Service and the apps' "about" text now say Apache License 2.0, and contributions need a DCO sign-off (see CONTRIBUTING.md).
- Updated dependencies [e435a66]
- Updated dependencies [6051aba]
- Updated dependencies [d3889ef]
- Updated dependencies [05deacd]
  - @escapesuite/shared@1.4.10

## 2.18.27

### Patch Changes

- 8fa2110: Three controls now carry their visible text in their accessible name (WCAG 2.5.3 Label in Name, ESCSUITE-334), which axe-core 4.14 checks by default. In ESCAPEPLAN, the header's logo link reads "ESCAPE Suite" with a real space between the two words, so its name "ESCAPE Suite Home" contains it. In ESCAPECRAFT, each recording row's M4A button is named "Download <name> as M4A audio" instead of "... as audio (M4A)", because a parenthesised "(M4A)" is not the word "M4A" the button shows. In ESCAPEARTIST, the timeline's Add Track button is named by its visible "Add Track" instead of a different "Add new track"; the title stays as a description. A speech-input user can now activate each control by saying what it shows.

## 2.15.73

### Patch Changes

- Updated dependencies [be3e45e]
  - @escapesuite/shared@1.4.9

## 2.15.71

### Patch Changes

- Updated dependencies [a2bfdd1]
  - @escapesuite/shared@1.4.8

## 2.15.64

### Patch Changes

- 5f024d1: The hub's sitemap lists ESCAPECRAFT and ESCAPEARTIST, its hashed assets are cached for a year, and /favicon.ico no longer answers with the hub page.
  
  The sitemap now includes /craft/ and /artist/. The content-hashed files under /assets/ are served with a one-year immutable cache header instead of revalidating on every visit. A request for /favicon.ico is now a real 404 rather than the hub page with a 200.

## 2.15.58

### Patch Changes

- 51e62ba: A rendering error on any page of the hub now shows a message with a Reload button instead of a blank page.
  
  The landing page and the legal pages now sit inside the same error panel ESCAPECRAFT and ESCAPEARTIST already had. If a page ever fails to draw, you see a short message and a Reload button, and Reload brings you back to the same page.

## 2.15.56

### Patch Changes

- Updated dependencies [9cf0fdc]
  - @escapesuite/shared@1.4.7

## 2.15.37

### Patch Changes

- Updated dependencies [f2bd30b]
  - @escapesuite/shared@1.4.6

## 2.15.30

### Patch Changes

- Updated dependencies [e48f6c6]
  - @escapesuite/shared@1.4.5

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
