# Changelog

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
