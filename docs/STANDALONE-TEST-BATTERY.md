# Standalone Version Test Battery

This document provides a complete test battery for testing the ESCAPESUITE standalone licensing and distribution system.

## Overview

The standalone version allows customers to run ESCAPECRAFT and ESCAPEARTIST locally without requiring a SaaS subscription. Each standalone build has a license key embedded at build time.

## Test Scenarios

### Scenario 1: New Customer - Suite License (Lifetime)

**Test Customer:**
- Name: Acme Corp
- Email: acme@example.com
- Product: Suite (both CRAFT and ARTIST)
- Tier: Lifetime
- Expiration: Never (perpetual)

### Scenario 2: Standard Customer - Single Product

**Test Customer:**
- Name: Test User
- Email: user@example.com
- Product: ESCAPECRAFT only
- Tier: Standard
- Expiration: 1 year from purchase

### Scenario 3: Pro Customer - Expiring License

**Test Customer:**
- Name: Pro Corp
- Email: pro@example.com
- Product: ESCAPEARTIST only
- Tier: Pro
- Expiration: 2026-12-31 (for testing expiration)

## Step-by-Step Test Procedure

### Step 1: Generate a Test License

From the monorepo root, run the license generator:

```bash
# Suite License (perpetual)
node apps/plan/scripts/generate-license.js "Acme Corp" suite "" "acme@example.com" "lifetime"

# Single Product with Expiration
node apps/plan/scripts/generate-license.js "Test User" craft "2027-01-15" "user@example.com" "standard"

# Pro License with Expiration
node apps/plan/scripts/generate-license.js "Pro Corp" artist "2026-12-31" "pro@example.com" "pro"
```

The generator outputs the license key in the format: `ESCAPE-<base64-encoded-json>`

### Step 2: Build Standalone Versions

Build with the license embedded:

**Linux/macOS:**
```bash
VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="<your-license-key>" pnpm build:craft
VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="<your-license-key>" pnpm build:artist
```

**Windows (PowerShell):**
```powershell
$env:VITE_BUILD_MODE="standalone"
$env:VITE_LICENSE_KEY="<your-license-key>"
pnpm build:craft
pnpm build:artist
```

**Windows (cmd):**
```cmd
set VITE_BUILD_MODE=standalone && set VITE_LICENSE_KEY=<your-license-key> && pnpm build:craft
set VITE_BUILD_MODE=standalone && set VITE_LICENSE_KEY=<your-license-key> && pnpm build:artist
```

### Step 3: Verify Build Output

Check that the license is embedded:
```bash
# Check for ESCAPE- prefix (should find matches)
grep -o "ESCAPE-" apps/craft/dist/index.html | wc -l
grep -o "ESCAPE-" apps/artist/dist/index.html | wc -l

# Check for standalone mode
grep -o "standalone" apps/craft/dist/index.html | head -1

# Verify file sizes (single HTML with all assets inlined)
ls -la apps/craft/dist/index.html   # ~800 KB
ls -la apps/artist/dist/index.html  # ~1.1 MB
```

### Step 4: Serve Locally for Testing

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

Or open directly in browser:
- `file:///.../apps/craft/dist/index.html`
- `file:///.../apps/artist/dist/index.html`

### Step 5: Run Automated E2E Tests

```bash
cd apps/e2e && pnpm exec playwright test --config=playwright.standalone.config.ts
```

Expected: 27 tests pass (as of current version)

### Step 6: Manual Verification Checklist

#### ESCAPECRAFT (http://localhost:5184/)
- [ ] App loads without sign-in prompt
- [ ] No Clerk authentication UI visible
- [ ] Recording UI shows correctly
- [ ] Source selection (screen/webcam) works
- [ ] Theme toggle works
- [ ] Console shows "License validated: Licensed to <customer>"

#### ESCAPEARTIST (http://localhost:5185/)
- [ ] App loads without sign-in prompt
- [ ] No Clerk authentication UI visible
- [ ] Editor UI shows correctly
- [ ] Import/upload button visible
- [ ] Timeline component renders
- [ ] Preview area displays
- [ ] Export button visible
- [ ] Theme toggle works
- [ ] Console shows "License validated: Licensed to <customer>"

## License Validation Tests

### Test: Valid License Loads Successfully
1. Build with valid license
2. Open app
3. Verify app loads normally
4. Check console for "License validated" message

### Test: Invalid License Shows Error
1. Build with invalid/corrupted license key
2. Open app
3. Verify error screen displays
4. Error message should indicate license issue

### Test: Missing License Shows License Input Modal
1. Build with `VITE_BUILD_MODE=standalone` but no `VITE_LICENSE_KEY`
2. Open app
3. Verify license input modal displays
4. Modal should have field for entering license key
5. Enter valid license → app loads successfully
6. License is stored in localStorage for future sessions

### Test: Expired License Shows Error
1. Generate license with past expiration date
2. Build with expired license
3. Open app
4. Verify error screen displays
5. Error message should indicate expiration

### Test: Wrong Product License
1. Generate license for "craft" only
2. Build ESCAPEARTIST with this license
3. Open app
4. Verify error screen displays
5. Error message should indicate product mismatch

### Test: Suite License Works for Both Products
1. Generate license with product="suite"
2. Build both CRAFT and ARTIST with same license
3. Both apps should load successfully

## File Distribution Tests

### Test: Pre-Licensed Download from Portal
1. Sign in to ESCAPEPLAN at `/portal/downloads`
2. Verify user has a valid license in the database
3. Click "Download (Pre-Licensed)" button
4. Verify download starts with `escapecraft-standalone.html` or `escapeartist-standalone.html`
5. Open downloaded file locally (file://)
6. App should load immediately without prompting for license
7. Console shows "License validated: Licensed to <customer>"

### Test: Generic Download Requires License Entry
1. Sign in to ESCAPEPLAN at `/portal/downloads`
2. Click "Generic" download button
3. Open downloaded file locally
4. Verify license input modal appears
5. Enter license key from email receipt
6. App loads successfully

### Test: Single HTML File
1. Build standalone version
2. Verify `dist/index.html` is the only file needed
3. File should contain all JS/CSS/assets inlined
4. File should work when opened directly (file://)

### Test: Offline Operation
1. Build standalone version
2. Disconnect from internet
3. Open HTML file
4. App should work completely offline
5. No network requests should fail

## Console Logging

When running standalone apps, check the browser console for:

**Successful load:**
```
License validated: Licensed to Acme Corp - Perpetual license
```

**Invalid license:**
```
License signature verification failed
```

**Missing public key (dev mode):**
```
No license public key configured - signature verification skipped
```

## Known Limitations

1. **Development licenses**: The CLI generator creates development-only licenses (signature verification skipped)
2. **Production licenses**: Should be generated via the Supabase Edge Function with proper Ed25519 signatures

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

This uses the pre-configured `playwright.standalone.config.ts` which:
- Expects pre-built dist files
- Serves on ports 5184 (craft) and 5185 (artist)
- Runs 27 smoke tests

## Example Complete Test Run

```bash
# 1. Generate license
node apps/plan/scripts/generate-license.js "Test Corp" suite "" "test@example.com" "lifetime"

# 2. Copy the license key from output

# 3. Build both apps (replace <LICENSE_KEY> with actual key)
cd apps/craft && VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="<LICENSE_KEY>" pnpm build && cd ../..
cd apps/artist && VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="<LICENSE_KEY>" pnpm build && cd ../..

# 4. Verify builds
grep -c "ESCAPE-" apps/craft/dist/index.html
grep -c "ESCAPE-" apps/artist/dist/index.html

# 5. Run E2E tests
cd apps/e2e && pnpm exec playwright test --config=playwright.standalone.config.ts

# 6. Manual testing (in separate terminals)
cd apps/craft && pnpm exec vite preview --port 5184
cd apps/artist && pnpm exec vite preview --port 5185

# 7. Open in browser and verify
# http://localhost:5184/ - ESCAPECRAFT
# http://localhost:5185/ - ESCAPEARTIST
```

## Future Improvements Needed

1. **Update Checking**: Add in-app update notifications for standalone versions
2. **Offline-first Updates**: Allow checking for updates when connectivity is available
