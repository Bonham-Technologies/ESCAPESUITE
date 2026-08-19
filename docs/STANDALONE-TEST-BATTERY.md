# Offline (Standalone) Build Test Battery

This document is a manual test battery for the ESCAPESUITE **offline single-file build** —
ESCAPECRAFT and ESCAPEARTIST built with `VITE_BUILD_MODE=standalone` so each app compiles to one
self-contained HTML file that runs fully air-gapped, with no server, no accounts, and no network
requests.

## Step 1: Build Standalone Versions

From the monorepo root:

```bash
pnpm build:standalone
```

Or build one app at a time:

```bash
cd apps/craft && pnpm build:standalone
cd apps/artist && pnpm build:standalone
```

## Step 2: Verify Build Output

```bash
# Single HTML file with all assets inlined
ls -la apps/craft/dist/index.html
ls -la apps/artist/dist/index.html
```

## Step 3: Serve Locally for Testing

Using Vite preview:
```bash
cd apps/craft && pnpm exec vite preview --port 5184
cd apps/artist && pnpm exec vite preview --port 5185
```

Or using any static file server:
```bash
npx serve apps/craft/dist -l 5184
npx serve apps/artist/dist -l 5185
```

Or open directly in browser (fully offline, `file://` origin):
- `file:///.../apps/craft/dist/index.html`
- `file:///.../apps/artist/dist/index.html`

## Step 4: Run Automated E2E Tests

```bash
cd apps/e2e && pnpm exec playwright test --config=playwright.standalone.config.ts
```

## Step 5: Manual Verification Checklist

#### ESCAPECRAFT (http://localhost:5184/ or file://)
- [ ] App loads with no network requests (check DevTools Network tab)
- [ ] Recording UI shows correctly
- [ ] Source selection (screen/webcam) works
- [ ] Start/stop a recording and confirm it plays back
- [ ] Theme toggle works
- [ ] Download produces a valid WebM/MP4 file

#### ESCAPEARTIST (http://localhost:5185/ or file://)
- [ ] App loads with no network requests (check DevTools Network tab)
- [ ] Editor UI shows correctly
- [ ] Import/upload button visible and works
- [ ] Timeline component renders
- [ ] Preview area displays
- [ ] Add a clip, trim it, and confirm the change reflects in preview
- [ ] Export button works and produces a valid WebM/MP4 file
- [ ] Theme toggle works

## Offline Operation Test

1. Build standalone version
2. Disconnect from the internet
3. Open the HTML file (double-click, or `file://` in the browser)
4. App should work completely offline — record, edit, and export all function
5. No network requests should fail (DevTools Network tab should be empty aside from the initial
   file load)

## Single-File Sanity Check

1. Build standalone version
2. Verify `dist/index.html` is the only file needed
3. File should contain all JS/CSS/assets inlined (no external `<script src>` or `<link href>`
   pointing outside the file)
4. File should work when opened directly (`file://`) and when copied to another machine

## Cleanup

Kill background preview servers:
```bash
pkill -f "vite preview"
```

## CI/CD Integration

The standalone E2E tests run automatically via:
```bash
pnpm test:e2e:standalone
```

This uses the pre-configured `playwright.standalone.config.ts`, which expects pre-built dist
files and serves ESCAPECRAFT on port 5184 and ESCAPEARTIST on port 5185.
