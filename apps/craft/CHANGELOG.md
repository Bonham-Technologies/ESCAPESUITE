# Changelog

## 2.5.0

### Minor Changes

- 39cf86e: Recordings can be uploaded to an embedding host
  
  Every row in the recordings library gains an "Upload to host" button when
  ESCAPECRAFT is running inside an iframe: it posts `UPLOAD_RECORDING
  { id, name, blob }` to the parent window, handing over the stored blob itself
  by structured clone. A host that cannot reach the shared IndexedDB no longer
  has to. Standalone ESCAPECRAFT never draws the button — there would be no one
  to post to — and nothing goes over the network either way. A host that offers
  this action should name itself with `?hostOrigin=`: without it the post is
  addressed to `'*'`, which hands the recording's bytes to whatever page is
  framing ESCAPECRAFT.

### Patch Changes

- b724b65: WebCodecs recordings keep A/V sync at capture rates below 30 fps

## 2.4.2

### Patch Changes

- Updated dependencies [3b0fe5f]
  - @escapesuite/shared@1.3.3

## 2.4.1

### Patch Changes

- bd0a805: The MP4 button now checks the browser can encode H.264 before offering the download, instead of failing partway; if it cannot encode AAC the MP4 is offered without audio and says so, before the conversion and again after it. It reads "Checking..." for the moment that check takes, and where H.264 is missing it stays on screen, disabled, saying why.

## 2.4.0

### Minor Changes

- 4d62686: Download recordings as MP4 (H.264 + AAC) again — converted locally in the browser with progress and cancel; WebM stays the instant option.

## 2.3.11

### Patch Changes

- 7609a12: Lower CPU use while recording: only the audio meters redraw when levels change. The rest of the recorder — the header, the recordings list, the preview stage and the transport bar — is no longer redrawn a dozen times a second for the length of a take.
- Updated dependencies [236a7dc]
  - @escapesuite/shared@1.3.2

## 2.3.10

### Patch Changes

- Updated dependencies [50491ce]
  - @escapesuite/shared@1.3.1

## 2.3.9

### Patch Changes

- 47f2b92: Lower CPU use while recording: the audio meters now update about 12 times a second instead of on every frame, and a recording with no microphone or system audio no longer runs a meter at all — its meters are zeroed once at the start of the take instead.

## 2.3.8

### Patch Changes

- e66fb39: Dialogs behave like dialogs, for the keyboard and for a screen reader.
  
  - **Escape closes them.** The Recording Tips dialog had no way out but the mouse; it now
    closes on Escape, as the playback dialog already did.
  - **Focus goes in, stays in, and comes back.** Opening either dialog moves focus into it,
    Tab and Shift+Tab cycle within it instead of wandering onto the app behind, and closing it
    puts focus back on the button that opened it.
  - **The recorder's shortcuts no longer fire from inside a dialog.** Pressing R while the
    Recording Tips dialog was open started a screen recording behind it, complete with the
    browser's capture prompt; P, S and Escape reached the recorder the same way. Nothing
    behind a dialog takes keys now. Inside the playback dialog, the player keeps its own keys
    — Space, M and the arrows still work.
  - **The Recording Tips can be scrolled from the keyboard.** The tips scroll and hold no
    controls of their own, so there was nothing to Tab to and no way to reach the text below
    the fold without a mouse.
  - **The live recording label, the timer and the notice line are readable.** Their red was
    4.2:1 against the app's background, under the WCAG AA minimum; it has been lifted to
    5.7:1. The record button and the recording dot keep the original brand red.
- ee3d206: The record button tells the truth, and a failure is no longer silent.
  
  - **Record is disabled until it can actually record.** It used to be live from the first
    paint, while the browser was still being asked what it can capture — an early click did
    nothing at all, with no explanation. It now waits for that answer, and stays disabled
    with the reason on screen when nothing you have switched on can be captured in this
    browser, or when there is no storage space left for another take. The R shortcut follows
    the same rule.
  - **A recording that failed to save says so.** A failed save used to look exactly like a
    successful one: nothing in the library and nothing to explain it. Failures — a save that
    did not complete, a recordings list that could not be read, a capture the browser
    refused — are now announced in the header.
  - **You are told when system audio was not shared.** Switching on "System Audio" only asks
    for it; the browser's own share dialog has a separate tick box. If it was left clear, the
    app now says so and greys the System meter instead of leaving it sitting at zero.
  - **A recording that may not scrub says so.** When the container repair fails the take is
    still saved, as before, but you are told it may not be seekable rather than discovering
    it later.
  - **Downloads no longer get cancelled in some browsers**, and re-opening a recording no
    longer shows the previous one's duration.
- 5da3ddc: Three recorder fixes:
  
  - Pressing Escape during the countdown now releases the recorder along with the capture. It used to leave the audio graph and level monitor running, so a handful of cancelled takes in a row would exhaust the browser's audio contexts and stop recording from starting at all.
  - Microphone-only recordings work again. With both Screen and Webcam switched off, starting a take failed outright in Chrome; audio-only takes now record through the MediaRecorder path.
  - Stopping the screen share at an awkward moment is handled properly for screen-only and webcam-only takes. If the recording is paused, it now finishes and saves what was captured instead of sitting in Paused over a dead capture and producing a truncated file; if it happens during the countdown, the take is abandoned and the app returns to idle instead of starting a recording with no source; and if it happens just after you press Stop, the recording is still saved rather than being reported as a failure. Picture-in-Picture takes still cannot detect the share ending — the recorder there sees the composited canvas, not the screen itself.

## 2.3.1

### Patch Changes

- f46d27a: Internal: the thumbnail size and quality constants now have a single definition, shared between the preview-thumbnail helpers and the generator.

## 2.2.9

### Patch Changes

- 2b7f5db: Internal: the recorder screen is split into focused modules; no behaviour change.

## 2.2.5

### Patch Changes

- a71c87d: Preview playback does far less work per frame: the preview canvas is rasterised at its displayed size (a 4K project now plays at full frame rate instead of ~12 fps), the timecode and timeline playhead no longer re-render the editor each tick, and scrubbing with several clips on one source no longer composites twice.
  
  The picture-in-picture compositor no longer restores its canvas state twice per frame.

## 2.2.4

### Patch Changes

- 39a8f27: - A transition with media on only one side now runs as the transition it is: a wipe clips that side to the region it should occupy and a slide moves it, instead of every type fading.
  - A dissolve blurs in the preview the way it already did in an export, so what you see on the canvas is what the exported file contains.
  - The inspector no longer reads an opaque fill whose colour happens to end in `00` — pure red `#ff0000`, black `#000000` — as "no fill": the fill button, the colour picker and the fill-opacity slider all go by the colour's alpha channel now.
  - A clip whose media has not loaded no longer takes transform handles or counts as a video in the preview.
  - A recording that is cancelled stays cancelled: a recorder that flushes its last chunk after you cancel no longer saves that take to the library.

## 2.2.2

### Patch Changes

- 38d540f: Follow-up fixes from the coverage program:
  
  ESCAPECRAFT:
  
  - Closing or navigating away from the recorder mid-countdown or mid-take left the countdown and duration timers ticking and the screen, webcam and microphone still live; everything is now released as the recorder goes away.
  
  ESCAPEARTIST:
  
  - Ctrl/Cmd + "=" and Ctrl/Cmd + "-" zoomed the timeline and swallowed the browser's own page zoom; they now reach the browser, while plain "+", "=" and "-" still zoom the timeline.
  - Re-adding media the library already holds, unchanged — as a restored session does — recorded an undo step that undid nothing.

## 2.2.1

### Patch Changes

- f2b1be4: Bugs found and fixed while bringing both apps under a coverage floor:
  
  ESCAPECRAFT:
  
  - A recording whose thumbnail could not be extracted in time leaked the blob URL it had opened.
  - Converting a recording with an already-cancelled export hung instead of stopping straight away.
  - Cancelling a conversion between its two passes left the video and audio encoders open.
  - A compositor overlay with zero padding was given the default padding instead.
  - The screen and webcam capture stayed live after a take ended, so the browser kept showing "sharing" and the camera light stayed on.
  - The microphone stayed live after a take ended, for the same reason.
  - Disposing a recorder stopped nothing, leaving its combined stream running.
  
  ESCAPEARTIST:
  
  - Starting a new project left the previous project's markers on the timeline.
  - MP4 exports played a wipe-up transition as a wipe-down and vice versa; they now match the preview.
  - Cancelling an export while it was muxing was ignored, and the export finished anyway.
  - Ctrl+B never split the selected clip, and Ctrl+V changed the active tool instead of pasting.
  - Dragging a left, right, top or bottom resize handle in the preview resized both axes at once instead of the one being dragged.
  - Restoring a session could list the same media twice in the library.

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

## 2.0.0

### Major Changes

- ESCAPECRAFT is now free and open source under the MIT license.

  **Breaking changes:**

  - Removed all licensing, subscription, and account gating. There is no sign-in,
    no trial, no plan check — every feature is available to everyone.
  - Removed export watermarks. Recordings and exports are unbranded regardless of
    how the app is run.
  - Removed the license-key entry flow from the offline build. The standalone
    single-file build now runs with no key and no activation step.

  **Distribution:**

  - Offline single-file builds are attached directly to each GitHub Release,
    replacing the gated download portal. Grab `ESCAPECRAFT-2.0.0.html` from the
    latest release and open it on any machine — including air-gapped networks.

## 1.4.0

### Minor Changes

- 2f796b1: Add flexible download format options and recording improvements

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

- f37d020: Add WebCodecs-based recorder for proper WebM container output

  - New `WebCodecsRecorder` class using WebCodecs API and Mediabunny for muxing
  - Produces properly structured WebM files that work in Windows Media Player
  - Falls back to MediaRecorder-based recorder when WebCodecs is not available
  - Added `recorder-factory.ts` for automatic recorder selection based on browser support
  - VP9 video encoding at 2.5 Mbps, Opus audio encoding at 128 kbps
  - Preserves all existing recorder functionality (pause/resume, duration tracking, audio levels)

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

## 1.0.0 (2026-01-05)

### Features

- add Clerk auth integration and trial watermarks ([68980e2](https://github.com/bonham-technologies/ESCAPESUITE/commit/68980e2aca94a4f5ebfe9804b290996ca016bd97))
- add playback review and download for recordings ([561d278](https://github.com/bonham-technologies/ESCAPESUITE/commit/561d278d82f39c4152c6afebbf3e892af796832a))
- add testing infrastructure and CI pipeline ([28a577b](https://github.com/bonham-technologies/ESCAPESUITE/commit/28a577b2705ca54cefc6eac0d1d34abeccea59ec))
- initial ESCAPECRAFT recorder implementation ([4939b9b](https://github.com/bonham-technologies/ESCAPESUITE/commit/4939b9be4600fba6e35d5a50ae59b2dabaf98d29))

### Bug Fixes

- handle WebM metadata extraction issues ([e35ce4a](https://github.com/bonham-technologies/ESCAPESUITE/commit/e35ce4a8822eb83cb3ac3a5b1800cef7b8a008cb))
- improve recording save reliability and audio levels ([2f5209f](https://github.com/bonham-technologies/ESCAPESUITE/commit/2f5209ff711647f1938fa3271f894e544fcbc50f))
- resolve lint errors for CI ([b96f913](https://github.com/bonham-technologies/ESCAPESUITE/commit/b96f9138b404456ac55c849ba5a8ba9f89fbb55f))
- resolve lint errors in AuthGate.tsx ([2fd6ba6](https://github.com/bonham-technologies/ESCAPESUITE/commit/2fd6ba67b80dac096b14d92362b9d7065140abe7))
- update navigation links for new URL schema ([76c0a4a](https://github.com/bonham-technologies/ESCAPESUITE/commit/76c0a4a7f138af8834841229605a77a83cdd3a98))
- WebM scrubbing support and UI overflow ([65217f3](https://github.com/bonham-technologies/ESCAPESUITE/commit/65217f3b877d60fcb84ecb7fd64d9cdc5b7a6343))
