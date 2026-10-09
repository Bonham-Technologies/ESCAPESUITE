# @escapesuite/shared

## 1.4.5

### Patch Changes

- e48f6c6: Add `isFileOrigin()` to the shared config, true when the page was opened from disk (`file:`).

## 1.4.4

### Patch Changes

- cc1c8f6: Neither app had a React error boundary, so a render-time bug anywhere in the tree used to unmount the whole thing to a blank page — and in ESCAPECRAFT, whatever recorder was live kept capturing into a UI nobody could see or stop.
  
  `@escapesuite/shared` gets one `ErrorBoundary` component, mounted by `bootstrapApp()` around every app's root. It shows one minimal, accessible panel — a heading, one sentence, a Reload button, `role="alert"` — with no app-specific copy, logs the error to the console in dev only, and calls an optional `onError(error, info)` so a host app can release anything a crash would otherwise leave dangling.
  
  ESCAPECRAFT passes an `onError` that disposes the live take: the same `disposeRecorder()` and `stopAllStreamsRef.current()` the unmount teardown already calls, now reachable from outside React because `onError` is bound once at bootstrap, before any component (and so any ref) exists. ESCAPEARTIST holds no live capture a crash could leave running, so its `onError` is a documented no-op.

## 1.4.3

### Patch Changes

- a91f1e3: Every dialog's keyboard trap now sees a pinned control, a rich-text field or a native media player the same way a real browser does, and two open dialogs can no longer both close on one Escape.
  
  The shared `useDialogBehaviour` hook (CRAFT's two modals, all five of ARTIST's) used `el.offsetParent !== null` to decide what a dialog could Tab to — which a real browser also reports `null` for a `position: fixed` control, dropping it from the trap entirely rather than merely skipping it as hidden. It now reads `el.getClientRects().length > 0`, which asks "is this actually rendered" without caring about positioning. The trap's selector was also missing several tabbable element types — `[contenteditable]`, `audio[controls]`, `video[controls]`, `iframe` and `summary` — so Tab from one of those walked straight out of an `aria-modal` dialog instead of wrapping back inside; all are now included. Finally, Escape used to call `stopPropagation()`, which does nothing when two dialogs are each listening on `document` — so a second, overlapping dialog's Escape used to close both. A tiny open-dialog stack now makes sure only the topmost dialog's close handler actually runs. No dialog in either app can reach a two-open state today (every overlay already blocks the page behind it), so this last one is hardening rather than a fix for something reachable yet — but the pinned-control and rich-text/media cases are real gaps a future dialog could hit.

## 1.4.2

### Patch Changes

- 247f24c: `parseHostOrigin()` now warns when an embedding host passes an empty `?hostOrigin=` value, instead of silently treating it the same as no value at all.
  
  A bare `?hostOrigin=` or a valueless `?hostOrigin` — the shape a host produces when it interpolates an `undefined` variable into the iframe URL — used to return `null` with no console warning, even though the function's own doc comment promises one for every value it can't use. It is now treated like any other invalid `hostOrigin` and logs the same one-per-page-load `console.warn` naming the problem, so a misconfigured host is noticed instead of silently losing the targeted `postMessage` traffic. A host that never passes the parameter at all is unaffected and still gets silence. Also deleted four long-unused exports from the package's root barrel (`ESCAPE_SUITE_VERSION`, `SHARED_DB_NAME`, `isBrowser`, `isProduction`) that had no importer anywhere in the monorepo.

## 1.4.1

### Patch Changes

- 0a364ea: `parseHostOrigin()` now accepts any `?hostOrigin=` value a URL parser can read on the `http:` or `https:` scheme, and normalises it down to its origin, instead of rejecting anything but a bare origin.
  
  A host that builds its embed URL from `location.href`, or from a routed path, naturally ends up with a trailing slash or a path on the `hostOrigin` it passes in — `https://host.example/` or `https://host.example/app` rather than the bare `https://host.example`. Before this, that value was silently thrown away with one console warning the host operator would likely never see, and ESCAPECRAFT's "Upload to host" fell back to posting the recording's bytes to whatever page happened to be framing it. Now the value is normalised rather than discarded; only a value that cannot be parsed as a URL at all, one with an opaque origin (like a `data:` URL), or one on any scheme other than `http:`/`https:` (such as `ws:` or `file:` — no real host is ever served from one of those), is still rejected, and in that case "Upload to host" refuses to send the recording rather than broadcasting it.

## 1.4.0

### Minor Changes

- 7ce6894: ESCAPECRAFT can record the webcam as its own track. "Record webcam as a separate track" is a
  new opt-in in the Webcam Overlay panel, shown only while the screen and the webcam are both on
  and **off by default**: a take recorded with it on produces two files — the screen and the
  webcam — from one recorder driving two encoders off one clock, so the two are frame-aligned by
  construction. The webcam half appears as its own row in the library directly under its take,
  playable, downloadable and deletable on its own; deleting the take deletes both, and deleting
  the webcam row alone leaves an ordinary single-file take behind.
  
  It costs about **twice the CPU and twice the storage**, which the toggle says before you
  choose it, and it is **Chromium/Edge only** — it needs WebCodecs and
  `MediaStreamTrackProcessor`. Where a browser cannot serve it, or where there is not enough
  room for two tracks, the toggle stays on screen and disabled with the reason said out loud;
  the composited overlay recording is unchanged and is still what every other browser and every
  default take gets. The webcam half never costs the take its screen recording: if the camera's
  encoder, muxer or save fails, the screen recording is still stored and listed, and the app says
  the webcam track could not be saved.
  
  One interim limit, named on the row it applies to: **MP4 and M4A of a separate-tracks take
  cover the screen track only for now** — the webcam track is not included yet. Download the
  webcam part's own WebM from its row until the composite lands.
  
  For embedders: `UPLOAD_RECORDING` is still one message per library row, and its payload may now
  carry optional `role` (`'screen' | 'webcam' | 'mic' | 'system'`) and `takeId` fields — added
  only for a row that has them, so a host that knows nothing of takes receives exactly the
  `{ id, name, blob }` it received before. A single message listing every part of a take
  (`payload.parts`) is planned and will come with its own adoption note.
  
  `@escapesuite/shared`: `SourceVideo` gains five optional fields — `takeId`, `role`,
  `startOffset`, `overlayPlacement` and `hasWebcam` — and the `RecordingRole` /
  `OverlayPlacement` types beside them. The database version is unchanged and every existing
  recording is read exactly as before.

## 1.3.3

### Patch Changes

- 3b0fe5f: packaging: React is a peer dependency; the package type-checks itself

## 1.3.2

### Patch Changes

- 236a7dc: Modal keyboard behaviour lives in one place: `useDialogBehaviour`, exported as
  `@escapesuite/shared/hooks`. It moved out of ESCAPECRAFT — where it had been lifted from
  ESCAPEARTIST's export dialog — so all three dialogs in the suite share it, and gained an
  optional `isOpen` argument for a dialog that stays mounted while closed.

## 1.3.1

### Patch Changes

- 50491ce: The offline single-file builds no longer include the analytics runtime at all, so no analytics call can leave an offline build. `trackEvent()` returns before it reaches Vercel Analytics in a standalone build, and the gate is written so the bundler drops the library from the bundle rather than shipping it inert.

## 1.3.0

### Minor Changes

- 90969e4: New config helpers: `isEmbedded()`, `EDITOR_URL` / `editorUrl(params)` driven by the optional `VITE_EDITOR_URL` build variable, and `parseHostOrigin()`.

## 1.2.1

### Patch Changes

- b9f8928: Updated test tooling for the Node 24 baseline: vitest 5, jsdom 30, jest-dom 7, vite 8.2.2, eslint 10.9, mediabunny 1.55.2, and changesets 3.

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

## 1.1.0

### Minor Changes

- 0020d0e: Extract analytics trackEvent to @escapesuite/shared package

  - Add @escapesuite/shared/analytics module with shared trackEvent function
  - All apps now import trackEvent from shared package
  - App-specific analytics events remain in each app

- 246a63c: Extract auth UI components (AuthGate, ErrorScreen, LoadingScreen) to shared package

  - Move AuthGate, ErrorScreen, LoadingScreen components to @escapesuite/shared/auth
  - AuthGate now accepts appName, logo, and product props for customization
  - LoadingScreen accepts appName and logo props for app-specific branding
  - Apps use thin wrapper components that provide app-specific defaults
  - Removes ~240 lines of duplicated code across craft and artist

- 8c64a95: Extract auth utilities to @escapesuite/shared package

  - Add @escapesuite/shared/auth module with:
    - Config utilities (BUILD_MODE, isSaaSMode, isStandaloneMode)
    - AuthContext and useAuth hook
    - License validation with product parameter
    - Subscription API client
  - craft/artist now import from shared package

- dc3194d: Add app bootstrap utility for consistent initialization

  - Add `@escapesuite/shared/bootstrap` with `bootstrapApp()` function
  - Handles SaaS vs Standalone mode detection and auth wrapping
  - Dynamic loading of Clerk and Sentry (excludes from standalone bundle)
  - Simplifies main.tsx in craft and artist from ~53 lines to ~14 lines

- d5477d3: Extract Sentry configuration to @escapesuite/shared package

  - Add @escapesuite/shared/sentry module with shared initSentry function
  - Support product tagging via options parameter
  - All apps now import from shared package with app-specific product tags

- 08422a9: Extract IndexedDB storage operations to @escapesuite/shared package

  - Add @escapesuite/shared/storage module with:
    - Shared database configuration (DB_NAME, DB_VERSION)
    - Common video/thumbnail operations
    - Settings operations
    - Storage utilities
  - craft/artist now import from shared package
  - App-specific operations remain in each app

- 27869d5: Extract theme system to @escapesuite/shared package

  - Add @escapesuite/shared/theme module with storage-agnostic theme utilities
  - Add ThemeToggle component to shared package
  - All apps now use the shared theme module with app-specific storage adapters
  - Reduces ~500 lines of duplicated theme code

- 4fb6bd3: Extract shared types to @escapesuite/shared package

  - Add @escapesuite/shared/types module with:
    - MediaType, MediaSource types
    - WaveformPeak interface
    - SourceVideo interface
  - craft/artist now import shared types from shared package

- 33adadf: Extract time utilities and watermark module to shared package

  - Add @escapesuite/shared/utils with time formatting functions (formatTimecode, formatTime, formatDuration, parseTimecode, etc.)
  - Add @escapesuite/shared/watermark with drawWatermark function and StreamWatermarker class
  - Apps now re-export from shared, reducing duplication
  - Removes ~200 lines of duplicated code
