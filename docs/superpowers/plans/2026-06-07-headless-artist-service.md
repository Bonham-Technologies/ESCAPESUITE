# Headless ARTIST — Render Service & Kit (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-retool note (2026-08):** ESCAPESUITE went MIT open source — accounts,
> Supabase, licensing (`packages/shared/src/auth/*`), and watermarking were removed
> from the repo. Every **license gate / genuine-software enforcement** element below
> is therefore obsolete as written and needs a product decision before Plan 2 is
> implemented; the rest of the design (bundle, runner, adapters, verification
> manifest) still stands.

**Goal:** Build `services/headless-artist` — a stateless Node one-shot CLI that license-gates, loads a project + sources from local files, drives the Plan‑1 headless bundle in real headless Chromium, and delivers the rendered video + a verification manifest through a pluggable output sink — shipped as a code kit (npm tarball) with an optional reference Dockerfile.

**Architecture:** The CLI is a pure function: `job spec → (license gate) → (input loader) → (Chromium render via Plan‑1 `window.__renderProject`) → (output sink) → exit`. No queue/state — the customer's broker spawns it per job. License verification reuses ONE shared Ed25519 implementation (refactored to be env-agnostic so browser + Node share it — no fork). Inputs/outputs are local by default; S3/webhook/command are optional reference adapters.

**Tech Stack:** TypeScript, Node 20+ (`globalThis.crypto.subtle` Ed25519), Playwright (real headless Chromium), `tsx` (run TS), `esbuild` (bundle the kit), Vitest, optional `@aws-sdk/client-s3`. Reuses `@escapesuite/shared` (license) + the Plan‑1 `dist-headless/headless.html` bundle.

---

## Scope & prerequisites

**Plan 2 of 2.** Depends on **Plan 1** (`docs/superpowers/plans/2026-06-07-headless-artist-render-bundle.md`) — specifically the built `apps/artist/dist-headless/headless.html` and the `RenderInput`/`RenderResult` contract (`apps/artist/src/headless/types.ts`). Spec: `docs/superpowers/specs/2026-06-07-headless-artist-design.md`.

## File structure

- `packages/shared/src/auth/license.ts` — **modify.** Extract a pure, env-agnostic `verifyLicenseSignature(payload, publicKeyHex)` + `parseLicenseKey(key)` + `payloadToLicense(payload)`; the existing browser `verifySignatureAsync`/`validateLicenseAsync` delegate to them (behavior unchanged). One implementation, shared.
- `services/headless-artist/package.json` — **create.** Node service package (type module).
- `services/headless-artist/tsconfig.json` — **create.**
- `services/headless-artist/src/types.ts` — **create.** `JobSpec`, `RenderOutcome`.
- `services/headless-artist/src/licenseGate.ts` — **create.** Node fail-closed gate over the shared verifier.
- `services/headless-artist/src/loaders.ts` — **create.** `loadBundle(path)` / `loadManifest(path)` → `RenderInput`.
- `services/headless-artist/src/renderDriver.ts` — **create.** Playwright launch + drive `__renderProject`.
- `services/headless-artist/src/sinks.ts` — **create.** `OutputSink` + `volume`/`command`/`webhook` (+ optional `s3`).
- `services/headless-artist/src/manifest.ts` — **create.** Verification manifest builder.
- `services/headless-artist/src/cli.ts` — **create.** One-shot entrypoint.
- `services/headless-artist/src/test-helpers/signLicense.ts` — **create.** Test-only Ed25519 license signer.
- `services/headless-artist/Dockerfile` — **create.** Optional reference image.
- `services/headless-artist/README.md` — **create.** Config + deploy + Chromium prereq docs.
- `pnpm-workspace.yaml` — **modify.** Add `services/*`.
- `apps/artist/src/headless/types.ts` — **modify (tiny).** Re-export from the service via a shared path, OR the service imports it directly (see Task 2).

---

## Task 1: Extract a portable, shared license verifier (no fork)

**Files:**
- Modify: `packages/shared/src/auth/license.ts`
- Test: `packages/shared/src/auth/license.verify.test.ts`

Goal: one Ed25519 verification implementation usable from both the Vite browser build and plain Node. The browser keeps its exact fail-open-in-DEV behavior; the pure function takes the public key explicitly.

- [ ] **Step 1: Write the failing test (pure verifier + parser, no import.meta.env)**

```ts
// packages/shared/src/auth/license.verify.test.ts
import { describe, it, expect } from 'vitest'
import { parseLicenseKey, verifyLicenseSignature, payloadToLicense } from './license'

// A deterministic Ed25519 keypair + a signed payload generated once with Node crypto.
// (Replace the three constants below by running scripts/gen in Step 4 if they drift.)
import { TEST_PUBLIC_KEY_HEX, TEST_LICENSE_KEY, TEST_TAMPERED_KEY } from './license.testfixtures'

describe('portable license verifier', () => {
  it('parses an ESCAPE- key into a payload', () => {
    const p = parseLicenseKey(TEST_LICENSE_KEY)
    expect(p).not.toBeNull()
    expect(p!.product).toBeDefined()
    expect(p!.signature).toBeTypeOf('string')
  })

  it('verifies a genuine signature against the matching public key', async () => {
    const p = parseLicenseKey(TEST_LICENSE_KEY)!
    expect(await verifyLicenseSignature(p, TEST_PUBLIC_KEY_HEX)).toBe(true)
  })

  it('rejects a tampered payload', async () => {
    const p = parseLicenseKey(TEST_TAMPERED_KEY)!
    expect(await verifyLicenseSignature(p, TEST_PUBLIC_KEY_HEX)).toBe(false)
  })

  it('rejects when no public key is supplied (fail closed)', async () => {
    const p = parseLicenseKey(TEST_LICENSE_KEY)!
    expect(await verifyLicenseSignature(p, '')).toBe(false)
  })

  it('maps a payload to a License', () => {
    const p = parseLicenseKey(TEST_LICENSE_KEY)!
    const lic = payloadToLicense(p)
    expect(lic.customer).toBeDefined()
    expect(lic.product).toBe(p.product)
  })
})
```

- [ ] **Step 2: Generate the test fixtures (one-time, committed)**

Create `packages/shared/src/auth/gen-license-testfixtures.mjs`:

```js
// Run once: node packages/shared/src/auth/gen-license-testfixtures.mjs > packages/shared/src/auth/license.testfixtures.ts
import { generateKeyPairSync, sign } from 'node:crypto'
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const jwk = publicKey.export({ format: 'jwk' })
const pubBytes = Buffer.from(jwk.x, 'base64url')
const pubHex = pubBytes.toString('hex')
const payload = {
  id: 'lic-test', version: 1, customer: { id: 'org-1', email: 'qa@example.com', name: 'QA' },
  product: 'suite', tier: 'pro', seats: 100, issued: '2026-01-01', expires: '2999-01-01', features: ['render'],
}
const msg = Buffer.from(JSON.stringify(payload))
const sig = sign(null, msg, privateKey).toString('base64')
const signed = { ...payload, signature: sig }
const key = 'ESCAPE-' + Buffer.from(JSON.stringify(signed)).toString('base64')
const tampered = { ...signed, seats: 999999 }
const tamperedKey = 'ESCAPE-' + Buffer.from(JSON.stringify(tampered)).toString('base64')
process.stdout.write(
  `// AUTO-GENERATED test fixtures (gen-license-testfixtures.mjs). Do not hand-edit.\n` +
  `export const TEST_PUBLIC_KEY_HEX = ${JSON.stringify(pubHex)}\n` +
  `export const TEST_LICENSE_KEY = ${JSON.stringify(key)}\n` +
  `export const TEST_TAMPERED_KEY = ${JSON.stringify(tamperedKey)}\n`
)
```

Run: `node packages/shared/src/auth/gen-license-testfixtures.mjs > packages/shared/src/auth/license.testfixtures.ts`
Expected: creates `license.testfixtures.ts` with three exported constants.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter=@escapesuite/shared exec vitest run src/auth/license.verify.test.ts`
Expected: FAIL — `parseLicenseKey`/`verifyLicenseSignature`/`payloadToLicense` not exported.

- [ ] **Step 4: Refactor `license.ts` to expose the pure core**

In `packages/shared/src/auth/license.ts`, add these exports (reusing the existing `hexToBytes`, `base64ToBytes`, `toArrayBuffer`, `SignedLicensePayload`, and the rename of `parseNewFormat`):

```ts
// Rename parseNewFormat → parseLicenseKey and EXPORT it (same body):
export function parseLicenseKey(licenseKey: string): SignedLicensePayload | null {
  try {
    if (!licenseKey.startsWith('ESCAPE-')) return null
    const encoded = licenseKey.substring(7)
    const json = new TextDecoder().decode(base64ToBytes(encoded))
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** Pure Ed25519 verify — public key passed in explicitly (no env coupling). */
export async function verifyLicenseSignature(
  payload: SignedLicensePayload,
  publicKeyHex: string,
): Promise<boolean> {
  if (!publicKeyHex) return false // fail closed when no key supplied
  try {
    const publicKey = await crypto.subtle.importKey(
      'raw', toArrayBuffer(hexToBytes(publicKeyHex)), { name: 'Ed25519' }, false, ['verify'],
    )
    const { signature, ...payloadWithoutSig } = payload
    const messageBytes = new TextEncoder().encode(JSON.stringify(payloadWithoutSig))
    return await crypto.subtle.verify('Ed25519', publicKey, toArrayBuffer(base64ToBytes(signature)), messageBytes)
  } catch {
    return false
  }
}

export function payloadToLicense(p: SignedLicensePayload): License {
  return {
    id: p.id, customer: p.customer?.name ?? p.customer?.id ?? '', email: p.customer?.email,
    product: p.product, tier: p.tier, seats: p.seats, issued: p.issued,
    expires: p.expires ?? null, features: p.features ?? [],
  }
}
```

Then make the existing browser path delegate (preserving DEV fail-open + prod fail-closed):

```ts
// Replace the body of the existing verifySignatureAsync with:
async function verifySignatureAsync(payload: SignedLicensePayload): Promise<boolean> {
  if (!PUBLIC_KEY_HEX) {
    if (import.meta.env.DEV) {
      console.warn('[license] No public key configured — signature verification SKIPPED (dev only).')
      return true
    }
    console.error('[license] No license public key baked into this build — rejecting license (fail closed).')
    return false
  }
  return verifyLicenseSignature(payload, PUBLIC_KEY_HEX)
}
```

Update the internal call site that used `parseNewFormat(...)` to `parseLicenseKey(...)`.

- [ ] **Step 5: Run the new test AND the existing license tests**

Run: `pnpm --filter=@escapesuite/shared exec vitest run src/auth/`
Expected: PASS — the new `license.verify.test.ts` AND all pre-existing license tests (browser behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/auth/license.ts packages/shared/src/auth/license.verify.test.ts \
  packages/shared/src/auth/license.testfixtures.ts packages/shared/src/auth/gen-license-testfixtures.mjs
git commit -m "refactor(shared): extract portable Ed25519 license verifier (browser+node share one impl)"
```

---

## Task 2: Scaffold the `services/headless-artist` package

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `services/headless-artist/package.json`, `tsconfig.json`, `src/types.ts`

- [ ] **Step 1: Add the workspace glob**

Edit `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
```

- [ ] **Step 2: Create `services/headless-artist/package.json`**

```json
{
  "name": "@escapesuite/headless-artist",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "bin": { "headless-artist": "./dist/cli.js" },
  "scripts": {
    "build": "esbuild src/cli.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/cli.js",
    "render": "tsx src/cli.ts",
    "lint": "eslint .",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "@escapesuite/shared": "workspace:*",
    "playwright": "^1.58.0"
  },
  "devDependencies": {
    "@types/node": "^25.2.2",
    "esbuild": "^0.27.2",
    "tsx": "^4.19.0",
    "typescript": "~5.9.3",
    "vitest": "^4.1.7"
  },
  "optionalDependencies": {
    "@aws-sdk/client-s3": "^3.700.0"
  }
}
```

- [ ] **Step 3: Create `services/headless-artist/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "types": ["node"], "resolveJsonModule": true, "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `services/headless-artist/src/types.ts`**

```ts
// Re-use the render contract Plan 1 defined.
import type { RenderInput, RenderMeta } from '../../../apps/artist/src/headless/types'
export type { RenderInput, RenderMeta }

export interface JobSpec {
  jobId: string
  input:
    | { bundle: { path: string } }
    | { manifest: { path: string } }
  options: RenderInput['options']
  watermark?: RenderInput['watermark']
  output: { sink: 'volume' | 's3' | 'webhook' | 'command'; config: Record<string, unknown> }
}

export interface RenderOutcome {
  jobId: string
  ok: boolean
  meta?: RenderMeta
  outputLocation?: string
  error?: string
}
```

- [ ] **Step 5: Install + commit**

Run: `pnpm install`
Expected: the new workspace package resolves; Playwright installed.

```bash
git add pnpm-workspace.yaml services/headless-artist/package.json services/headless-artist/tsconfig.json services/headless-artist/src/types.ts pnpm-lock.yaml
git commit -m "chore(headless-artist): scaffold service package"
```

---

## Task 3: Node license gate (fail-closed)

**Files:**
- Create: `services/headless-artist/src/licenseGate.ts`
- Create: `services/headless-artist/src/licenseGate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/headless-artist/src/licenseGate.test.ts
import { describe, it, expect } from 'vitest'
import { assertLicensed } from './licenseGate'
import { TEST_PUBLIC_KEY_HEX, TEST_LICENSE_KEY, TEST_TAMPERED_KEY } from '../../../packages/shared/src/auth/license.testfixtures'

const ok = { LICENSE_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX, LICENSE_KEY: TEST_LICENSE_KEY }

describe('assertLicensed', () => {
  it('resolves to a License for a genuine, unexpired, entitled key', async () => {
    const lic = await assertLicensed(ok, 'artist')
    expect(lic.product === 'suite' || lic.product === 'artist').toBe(true)
  })
  it('throws when the key is missing', async () => {
    await expect(assertLicensed({ LICENSE_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX }, 'artist')).rejects.toThrow(/license/i)
  })
  it('throws when the signature is tampered', async () => {
    await expect(assertLicensed({ ...ok, LICENSE_KEY: TEST_TAMPERED_KEY }, 'artist')).rejects.toThrow(/signature|invalid/i)
  })
  it('throws when no public key is configured (fail closed)', async () => {
    await expect(assertLicensed({ LICENSE_KEY: TEST_LICENSE_KEY }, 'artist')).rejects.toThrow()
  })
  it('throws when expired', async () => {
    const lic = await assertLicensed(ok, 'artist', new Date('3000-01-01'))
    // expires 2999 → now 3000 ⇒ expired
    .then(() => 'no-throw').catch((e) => e.message)
    expect(String(lic)).toMatch(/expired/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/licenseGate.test.ts`
Expected: FAIL — `Cannot find module './licenseGate'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/headless-artist/src/licenseGate.ts
import { parseLicenseKey, verifyLicenseSignature, payloadToLicense } from '@escapesuite/shared/auth'
import type { License } from '@escapesuite/shared/auth'

export class LicenseError extends Error {}

/**
 * Fail-closed license gate. Verifies a genuine ESCAPE- license (offline Ed25519),
 * entitled for server render of `product`, not expired. Throws LicenseError otherwise.
 */
export async function assertLicensed(
  env: { LICENSE_KEY?: string; LICENSE_PUBLIC_KEY?: string },
  product: 'artist',
  now: Date = new Date(),
): Promise<License> {
  const key = env.LICENSE_KEY
  const pub = env.LICENSE_PUBLIC_KEY
  if (!key) throw new LicenseError('No LICENSE_KEY provided — refusing to render (fail closed).')
  if (!pub) throw new LicenseError('No LICENSE_PUBLIC_KEY configured — refusing to render (fail closed).')

  const payload = parseLicenseKey(key)
  if (!payload) throw new LicenseError('Malformed license key.')

  if (!(await verifyLicenseSignature(payload, pub))) {
    throw new LicenseError('Invalid license signature.')
  }

  const lic = payloadToLicense(payload)
  // 'suite' covers all apps; 'artist' covers artist. (craft-only does not entitle artist render.)
  if (!(lic.product === 'suite' || lic.product === product)) {
    throw new LicenseError(`License product "${lic.product}" does not entitle ${product} render.`)
  }
  if (lic.expires && new Date(lic.expires) < now) {
    throw new LicenseError(`License expired on ${lic.expires}.`)
  }
  return lic
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/licenseGate.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add services/headless-artist/src/licenseGate.ts services/headless-artist/src/licenseGate.test.ts
git commit -m "feat(headless-artist): fail-closed Node license gate over shared verifier"
```

---

## Task 4: Input loaders (bundle + manifest → RenderInput)

**Files:**
- Create: `services/headless-artist/src/loaders.ts`
- Create: `services/headless-artist/src/loaders.test.ts`
- Create: `services/headless-artist/test/fixtures/` (a `.veditor` + a manifest dir; reuse the Plan‑1 fixture source)

- [ ] **Step 1: Write the failing test**

```ts
// services/headless-artist/src/loaders.test.ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadBundle, loadManifest } from './loaders'

const FIX = resolve(__dirname, '../test/fixtures')

describe('input loaders', () => {
  it('loads a .veditor bundle into RenderInput', async () => {
    const input = await loadBundle(resolve(FIX, 'project.veditor'))
    expect(input.project.timeline.clips.length).toBeGreaterThan(0)
    expect(input.sourceVideos.length).toBeGreaterThan(0)
    const id = input.sourceVideos[0].id
    expect(input.sourceBlobs[id].byteLength).toBeGreaterThan(0)
  })

  it('loads a manifest + raw source files into RenderInput', async () => {
    const input = await loadManifest(resolve(FIX, 'manifest/manifest.json'))
    expect(input.sourceVideos.length).toBeGreaterThan(0)
    const id = input.sourceVideos[0].id
    expect(input.sourceBlobs[id].byteLength).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Create the fixtures**

```bash
mkdir -p services/headless-artist/test/fixtures/manifest
# Reuse the Plan-1 fixture source (a tiny 64x48 1s MP4):
cp apps/e2e/fixtures/headless/source.mp4 services/headless-artist/test/fixtures/manifest/src-0.mp4
```

Create `services/headless-artist/test/fixtures/manifest/manifest.json`:

```json
{
  "project": { "$ref": "./project.json" },
  "sources": [{ "id": "src-0", "mimeType": "video/mp4", "file": "src-0.mp4" }]
}
```

Copy the Plan‑1 project body into `services/headless-artist/test/fixtures/manifest/project.json` (the `project` object only — same shape used in Plan 1 Task 6).

Build the `.veditor` bundle fixture (project + base64 source) with a one-off script:

```bash
node -e '
const fs=require("fs");
const p=require("./services/headless-artist/test/fixtures/manifest/project.json");
const data=fs.readFileSync("./services/headless-artist/test/fixtures/manifest/src-0.mp4").toString("base64");
const veditor={version:1,project:p.project,videos:[{id:"src-0",name:"src-0.mp4",mimeType:"video/mp4",data}]};
fs.writeFileSync("./services/headless-artist/test/fixtures/project.veditor", JSON.stringify(veditor));
'
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/loaders.test.ts`
Expected: FAIL — `Cannot find module './loaders'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// services/headless-artist/src/loaders.ts
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { RenderInput } from './types'

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** Load a .veditor bundle ({ version, project, videos:[{id,name,mimeType,data(base64)}] }). */
export async function loadBundle(path: string): Promise<RenderInput> {
  const v = JSON.parse(await readFile(path, 'utf8'))
  const sourceVideos = v.videos.map((x: { id: string; name: string; mimeType: string }) => ({
    id: x.id, name: x.name, mimeType: x.mimeType,
  })) as RenderInput['sourceVideos']
  const sourceBlobs: Record<string, ArrayBuffer> = {}
  for (const x of v.videos) sourceBlobs[x.id] = toArrayBuffer(Buffer.from(x.data, 'base64'))
  return { project: v.project, sourceVideos, sourceBlobs, options: { format: 'mp4' } as RenderInput['options'] }
}

/** Load a manifest (project + raw source files on disk) referenced by relative paths. */
export async function loadManifest(path: string): Promise<RenderInput> {
  const dir = dirname(path)
  const m = JSON.parse(await readFile(path, 'utf8'))
  const projectRef = m.project?.$ref ? JSON.parse(await readFile(resolve(dir, m.project.$ref), 'utf8')) : m.project
  const project = projectRef.project ?? projectRef
  const sourceVideos: RenderInput['sourceVideos'] = []
  const sourceBlobs: Record<string, ArrayBuffer> = {}
  for (const s of m.sources as Array<{ id: string; mimeType: string; file: string }>) {
    sourceVideos.push({ id: s.id, name: s.file, mimeType: s.mimeType } as RenderInput['sourceVideos'][number])
    sourceBlobs[s.id] = toArrayBuffer(await readFile(resolve(dir, s.file)))
  }
  return { project, sourceVideos, sourceBlobs, options: { format: 'mp4' } as RenderInput['options'] }
}
```

> NOTE: `sourceVideos` entries must satisfy the real `SourceVideo` interface
> (`apps/artist/src/store/types.ts`). If the engine needs more metadata fields
> (e.g. duration/width/height), add them to the fixtures + the mapping; the Task‑8
> e2e render is the oracle.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/loaders.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/headless-artist/src/loaders.ts services/headless-artist/src/loaders.test.ts services/headless-artist/test/fixtures
git commit -m "feat(headless-artist): bundle + manifest input loaders"
```

---

## Task 5: Chromium render driver (Playwright drives the Plan‑1 bundle)

**Files:**
- Create: `services/headless-artist/src/renderDriver.ts`
- Create: `services/headless-artist/src/renderDriver.test.ts`

Prereq: the Plan‑1 bundle is built (`apps/artist/dist-headless/headless.html`).

- [ ] **Step 1: Write the failing test (integration — real Chromium)**

```ts
// services/headless-artist/src/renderDriver.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { loadBundle } from './loaders'
import { renderInChromium } from './renderDriver'

const BUNDLE = resolve(__dirname, '../../../apps/artist/dist-headless/headless.html')

beforeAll(() => {
  // Ensure the Plan-1 bundle + a Chromium are present.
  execSync('pnpm --filter=@escapesuite/artist run build:headless', { stdio: 'inherit' })
  execSync('pnpm --filter=@escapesuite/headless-artist exec playwright install chromium', { stdio: 'inherit' })
}, 180_000)

describe('renderInChromium', () => {
  it('renders a fixture project to MP4 bytes', async () => {
    const input = await loadBundle(resolve(__dirname, '../test/fixtures/project.veditor'))
    const { bytes, meta } = await renderInChromium(BUNDLE, input, { gpu: false, timeoutMs: 120_000 })
    expect(meta.format).toBe('mp4')
    expect(bytes.length).toBeGreaterThan(0)
    expect(Buffer.from(bytes.subarray(0, 12)).includes(Buffer.from('ftyp'))).toBe(true)
  }, 180_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/renderDriver.test.ts`
Expected: FAIL — `Cannot find module './renderDriver'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/headless-artist/src/renderDriver.ts
import { chromium, type LaunchOptions } from 'playwright'
import { pathToFileURL } from 'node:url'
import type { RenderInput, RenderMeta } from './types'

export interface RenderDriverOptions {
  gpu?: boolean
  chromiumPath?: string   // executablePath — point at a system/provided Chromium
  timeoutMs?: number
}

/** Launch headless Chromium, run the Plan-1 bundle's window.__renderProject, return bytes. */
export async function renderInChromium(
  bundleHtmlPath: string,
  input: RenderInput,
  opts: RenderDriverOptions = {},
): Promise<{ bytes: Uint8Array; meta: RenderMeta }> {
  const args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  if (opts.gpu) {
    args.push('--use-gl=angle', '--ignore-gpu-blocklist', '--enable-features=Vulkan')
  } else {
    args.push('--disable-gpu')
  }
  const launch: LaunchOptions = { headless: true, args }
  if (opts.chromiumPath) launch.executablePath = opts.chromiumPath

  const browser = await chromium.launch(launch)
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(opts.timeoutMs ?? 120_000)
    await page.goto(pathToFileURL(bundleHtmlPath).href)
    await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

    // Sources transfer as base64 (structured-clone of large ArrayBuffers across evaluate is costly/limited).
    const sourcesB64: Record<string, string> = {}
    for (const [id, buf] of Object.entries(input.sourceBlobs)) {
      sourcesB64[id] = Buffer.from(new Uint8Array(buf)).toString('base64')
    }

    const result = await page.evaluate(async (payload) => {
      const blobs: Record<string, ArrayBuffer> = {}
      for (const [id, b64] of Object.entries(payload.sourcesB64)) {
        const bin = atob(b64 as string); const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        blobs[id] = arr.buffer
      }
      const input = { project: payload.project, sourceVideos: payload.sourceVideos,
        sourceBlobs: blobs, options: payload.options, watermark: payload.watermark ?? null }
      // @ts-expect-error injected global
      return await window.__renderProject(input)
    }, { project: input.project, sourceVideos: input.sourceVideos, options: input.options, watermark: input.watermark, sourcesB64 })

    const bin = Buffer.from(result.base64, 'base64')
    const meta = { ...result.meta, gpu: !!opts.gpu }
    return { bytes: new Uint8Array(bin), meta }
  } finally {
    await browser.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/renderDriver.test.ts`
Expected: PASS — fixture renders to a valid MP4 (`ftyp` present).

- [ ] **Step 5: Commit**

```bash
git add services/headless-artist/src/renderDriver.ts services/headless-artist/src/renderDriver.test.ts
git commit -m "feat(headless-artist): Playwright Chromium render driver"
```

---

## Task 6: Verification manifest + output sinks

**Files:**
- Create: `services/headless-artist/src/manifest.ts`, `services/headless-artist/src/manifest.test.ts`
- Create: `services/headless-artist/src/sinks.ts`, `services/headless-artist/src/sinks.test.ts`

- [ ] **Step 1: Manifest — failing test**

```ts
// services/headless-artist/src/manifest.test.ts
import { describe, it, expect } from 'vitest'
import { buildManifest } from './manifest'

describe('buildManifest', () => {
  it('produces a sha256 + render metadata', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const m = buildManifest('job-1', bytes, { format: 'mp4', byteLength: 4, durationSec: 1, width: 64, height: 48, gpu: true }, { chromiumVersion: 'x', engineVersion: 'y' })
    expect(m.jobId).toBe('job-1')
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(m.byteLength).toBe(4)
    expect(m.gpu).toBe(true)
  })
})
```

- [ ] **Step 2: Manifest — implementation**

```ts
// services/headless-artist/src/manifest.ts
import { createHash } from 'node:crypto'
import type { RenderMeta } from './types'

export interface VerificationManifest extends RenderMeta {
  jobId: string
  sha256: string
  chromiumVersion: string
  engineVersion: string
  createdAt: string
}

export function buildManifest(
  jobId: string, bytes: Uint8Array, meta: RenderMeta,
  versions: { chromiumVersion: string; engineVersion: string }, now: Date = new Date(),
): VerificationManifest {
  return {
    ...meta, jobId,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    chromiumVersion: versions.chromiumVersion, engineVersion: versions.engineVersion,
    createdAt: now.toISOString(),
  }
}
```

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/manifest.test.ts` → PASS.

- [ ] **Step 3: Sinks — failing test (volume + command + webhook)**

```ts
// services/headless-artist/src/sinks.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getSink } from './sinks'
import { buildManifest } from './manifest'

const bytes = new Uint8Array([0x66, 0x74, 0x79, 0x70])
const meta = { format: 'mp4', byteLength: 4, durationSec: 1, width: 64, height: 48, gpu: false } as const
const manifest = buildManifest('job-1', bytes, meta, { chromiumVersion: 'x', engineVersion: 'y' })

describe('output sinks', () => {
  it('volume sink writes file + manifest sidecar', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'sink-'))
    const sink = await getSink('volume', { dir })
    const loc = await sink.deliver('job-1', bytes, manifest)
    expect(existsSync(resolve(dir, 'job-1.mp4'))).toBe(true)
    expect(JSON.parse(readFileSync(resolve(dir, 'job-1.manifest.json'), 'utf8')).sha256).toBe(manifest.sha256)
    expect(loc).toContain('job-1.mp4')
  })

  it('command sink invokes the configured command with args (no shell)', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'sinkcmd-'))
    const marker = resolve(dir, 'ran.txt')
    const sink = await getSink('command', { command: process.execPath, args: ['-e', `require('fs').writeFileSync(process.argv[1],'ok')`, marker] })
    await sink.deliver('job-1', bytes, manifest)
    expect(existsSync(marker)).toBe(true)
  })
})
```

- [ ] **Step 4: Sinks — implementation**

```ts
// services/headless-artist/src/sinks.ts
import { writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { VerificationManifest } from './manifest'

const pExecFile = promisify(execFile)

export interface OutputSink {
  deliver(jobId: string, bytes: Uint8Array, manifest: VerificationManifest): Promise<string>
}

function ext(format: string) { return format === 'webm' ? 'webm' : 'mp4' }

/** Default: write <jobId>.<ext> + <jobId>.manifest.json to a directory. */
function volumeSink(config: { dir: string }): OutputSink {
  return {
    async deliver(jobId, bytes, manifest) {
      await mkdir(config.dir, { recursive: true })
      const file = resolve(config.dir, `${jobId}.${ext(manifest.format)}`)
      await writeFile(file, bytes)
      await writeFile(resolve(config.dir, `${jobId}.manifest.json`), JSON.stringify(manifest, null, 2))
      return file
    },
  }
}

/** Opt-in: run a customer command (argument array — NO shell interpolation). */
function commandSink(config: { command: string; args?: string[]; writeTmp?: boolean }): OutputSink {
  return {
    async deliver(jobId, bytes, manifest) {
      // Pass the output via a temp file path appended as the final arg if requested.
      let args = config.args ?? []
      if (config.writeTmp) {
        const tmp = resolve(process.env.TMPDIR || '/tmp', `${jobId}.${ext(manifest.format)}`)
        await writeFile(tmp, bytes)
        args = [...args, tmp]
      }
      await pExecFile(config.command, args, { env: process.env })
      return `command:${config.command}`
    },
  }
}

/** Optional: POST the result + manifest to a customer endpoint (global fetch, Node 18+). */
function webhookSink(config: { url: string; headers?: Record<string, string> }): OutputSink {
  return {
    async deliver(jobId, bytes, manifest) {
      const form = new FormData()
      form.append('manifest', JSON.stringify(manifest))
      form.append('file', new Blob([bytes], { type: manifest.format === 'webm' ? 'video/webm' : 'video/mp4' }), `${jobId}.${ext(manifest.format)}`)
      const res = await fetch(config.url, { method: 'POST', headers: config.headers, body: form })
      if (!res.ok) throw new Error(`webhook sink failed: ${res.status}`)
      return config.url
    },
  }
}

// async so the optional 's3' case can dynamically import the AWS SDK (Task 8)
// without making @aws-sdk a hard dependency of the kit.
export async function getSink(kind: string, config: Record<string, unknown>): Promise<OutputSink> {
  switch (kind) {
    case 'volume': return volumeSink(config as { dir: string })
    case 'command': return commandSink(config as { command: string; args?: string[]; writeTmp?: boolean })
    case 'webhook': return webhookSink(config as { url: string; headers?: Record<string, string> })
    case 's3': {
      const { s3Sink } = await import('./s3') // optional @aws-sdk/client-s3 — provided in Task 8
      return s3Sink(config as { prefix: string; endpoint?: string; region?: string })
    }
    default: throw new Error(`Unknown output sink: ${kind}`)
  }
}
```

- [ ] **Step 5: Run sink + manifest tests**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/manifest.test.ts src/sinks.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/headless-artist/src/manifest.ts services/headless-artist/src/manifest.test.ts services/headless-artist/src/sinks.ts services/headless-artist/src/sinks.test.ts
git commit -m "feat(headless-artist): verification manifest + volume/command/webhook sinks"
```

---

## Task 7: One-shot CLI (gate → load → render → sink → exit)

**Files:**
- Create: `services/headless-artist/src/cli.ts`
- Create: `services/headless-artist/src/run.ts` (testable core, separate from argv parsing)
- Create: `services/headless-artist/src/run.test.ts`

- [ ] **Step 1: Write the failing test for the run core**

```ts
// services/headless-artist/src/run.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { runJob } from './run'
import { TEST_PUBLIC_KEY_HEX, TEST_LICENSE_KEY } from '../../../packages/shared/src/auth/license.testfixtures'

const BUNDLE = resolve(__dirname, '../../../apps/artist/dist-headless/headless.html')
const env = { LICENSE_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX, LICENSE_KEY: TEST_LICENSE_KEY }

describe('runJob', () => {
  it('renders a bundle job to the volume sink + manifest', async () => {
    const out = mkdtempSync(resolve(tmpdir(), 'job-'))
    const spec = {
      jobId: 'job-42',
      input: { bundle: { path: resolve(__dirname, '../test/fixtures/project.veditor') } },
      options: { format: 'mp4', quality: 'high' },
      output: { sink: 'volume', config: { dir: out } },
    }
    const outcome = await runJob(spec as Parameters<typeof runJob>[0], { env, bundlePath: BUNDLE, gpu: false })
    expect(outcome.ok).toBe(true)
    expect(existsSync(resolve(out, 'job-42.mp4'))).toBe(true)
    expect(JSON.parse(readFileSync(resolve(out, 'job-42.manifest.json'), 'utf8')).jobId).toBe('job-42')
  }, 180_000)

  it('fails closed without a license', async () => {
    const outcome = await runJob(
      { jobId: 'j', input: { bundle: { path: 'x' } }, options: { format: 'mp4' }, output: { sink: 'volume', config: { dir: '.' } } } as Parameters<typeof runJob>[0],
      { env: {}, bundlePath: BUNDLE, gpu: false },
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/license/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/run.test.ts`
Expected: FAIL — `Cannot find module './run'`.

- [ ] **Step 3: Implement the run core**

```ts
// services/headless-artist/src/run.ts
import { chromium } from 'playwright'
import { assertLicensed } from './licenseGate'
import { loadBundle, loadManifest } from './loaders'
import { renderInChromium } from './renderDriver'
import { buildManifest } from './manifest'
import { getSink } from './sinks'
import type { JobSpec, RenderOutcome } from './types'

export interface RunDeps {
  env: { LICENSE_KEY?: string; LICENSE_PUBLIC_KEY?: string }
  bundlePath: string
  gpu?: boolean
  chromiumPath?: string
  timeoutMs?: number
}

const ENGINE_VERSION = process.env.ARTIST_ENGINE_VERSION || 'unknown'

export async function runJob(spec: JobSpec, deps: RunDeps): Promise<RenderOutcome> {
  try {
    await assertLicensed(deps.env, 'artist')

    const input = 'bundle' in spec.input
      ? await loadBundle(spec.input.bundle.path)
      : await loadManifest(spec.input.manifest.path)
    input.options = spec.options
    input.watermark = spec.watermark ?? null

    const { bytes, meta } = await renderInChromium(deps.bundlePath, input, {
      gpu: deps.gpu, chromiumPath: deps.chromiumPath, timeoutMs: deps.timeoutMs,
    })

    const manifest = buildManifest(spec.jobId, bytes, meta, {
      chromiumVersion: chromium.name() + '@' + (process.env.PLAYWRIGHT_CHROMIUM_VERSION || 'pinned'),
      engineVersion: ENGINE_VERSION,
    })
    const sink = await getSink(spec.output.sink, spec.output.config)
    const outputLocation = await sink.deliver(spec.jobId, bytes, manifest)

    return { jobId: spec.jobId, ok: true, meta, outputLocation }
  } catch (err) {
    return { jobId: spec.jobId, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter=@escapesuite/artist run build:headless && pnpm --filter=@escapesuite/headless-artist exec vitest run src/run.test.ts`
Expected: PASS (render + license-denied).

- [ ] **Step 5: Implement the CLI wrapper**

```ts
// services/headless-artist/src/cli.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runJob } from './run'
import type { JobSpec } from './types'

function readJobSpec(arg?: string): JobSpec {
  if (!arg || arg === '-') return JSON.parse(readFileSync(0, 'utf8')) // stdin
  return JSON.parse(readFileSync(arg, 'utf8'))
}

async function main() {
  const [cmd, jobArgFlagOrPath, maybePath] = process.argv.slice(2)
  if (cmd !== 'render') { console.error('usage: headless-artist render --job <file|->'); process.exit(2) }
  const jobPath = jobArgFlagOrPath === '--job' ? maybePath : jobArgFlagOrPath
  const spec = readJobSpec(jobPath)

  // Bundle ships next to the CLI in the kit (dist/headless.html); overridable via env for dev.
  const here = resolve(fileURLToPath(import.meta.url), '..')
  const bundlePath = process.env.HEADLESS_BUNDLE_PATH || resolve(here, 'headless.html')

  const outcome = await runJob(spec, {
    env: process.env,
    bundlePath,
    gpu: process.env.HEADLESS_GPU === 'true',
    chromiumPath: process.env.HEADLESS_CHROMIUM_PATH,
    timeoutMs: process.env.HEADLESS_TIMEOUT_MS ? Number(process.env.HEADLESS_TIMEOUT_MS) : undefined,
  })

  console.log(JSON.stringify(outcome))
  process.exit(outcome.ok ? 0 : 1)
}

main()
```

- [ ] **Step 6: Commit**

```bash
git add services/headless-artist/src/run.ts services/headless-artist/src/run.test.ts services/headless-artist/src/cli.ts
git commit -m "feat(headless-artist): one-shot CLI (gate → load → render → sink → exit codes)"
```

---

## Task 8: Optional S3 reference adapters (input + output)

**Files:**
- Create: `services/headless-artist/src/s3.ts`
- Create: `services/headless-artist/src/s3.test.ts` (skipped unless `S3_TEST_ENDPOINT` is set, e.g. local MinIO)

This is the reference transport for today's customer; it is OPTIONAL (the canonical boundary is local files). Code is real but gated behind the optional `@aws-sdk/client-s3` dependency.

- [ ] **Step 1: Implement the S3 fetch-to-local input + put-output**

```ts
// services/headless-artist/src/s3.ts
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { OutputSink } from './sinks'
import type { VerificationManifest } from './manifest'

function client(cfg: { endpoint?: string; region?: string }): S3Client {
  return new S3Client({ endpoint: cfg.endpoint, region: cfg.region || 'us-east-1', forcePathStyle: !!cfg.endpoint })
}
function parseS3(uri: string): { bucket: string; key: string } {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri); if (!m) throw new Error(`bad s3 uri: ${uri}`)
  return { bucket: m[1], key: m[2] }
}

/** Fetch an s3:// object to a local dir; returns the local path. */
export async function fetchS3ToLocal(uri: string, destDir: string, cfg: { endpoint?: string; region?: string }): Promise<string> {
  const { bucket, key } = parseS3(uri)
  const res = await client(cfg).send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const bytes = await res.Body!.transformToByteArray()
  await mkdir(destDir, { recursive: true })
  const local = resolve(destDir, key.split('/').pop()!)
  await writeFile(local, bytes)
  return local
}

/** Output sink that PUTs the result + manifest to an s3:// prefix. */
export function s3Sink(config: { prefix: string; endpoint?: string; region?: string }): OutputSink {
  return {
    async deliver(jobId: string, bytes: Uint8Array, manifest: VerificationManifest) {
      const c = client(config)
      const { bucket, key } = parseS3(config.prefix.replace(/\/$/, '') + `/${jobId}.${manifest.format === 'webm' ? 'webm' : 'mp4'}`)
      await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: manifest.format === 'webm' ? 'video/webm' : 'video/mp4' }))
      const mkey = key.replace(/\.(mp4|webm)$/, '.manifest.json')
      await c.send(new PutObjectCommand({ Bucket: bucket, Key: mkey, Body: JSON.stringify(manifest), ContentType: 'application/json' }))
      return `s3://${bucket}/${key}`
    },
  }
}
```

- [ ] **Step 2: (no `getSink` change needed)**

The `s3` case and the async `getSink` signature were already defined in Task 6 (Task 6 dynamic-imports `./s3`). This task only supplies the `./s3` module the case imports. Optionally, wire `fetchS3ToLocal` into the loaders for jobs whose input is an `s3://` ref — but the canonical, guaranteed path stays local files the customer mounts (per the spec), so this is additive.

- [ ] **Step 3: Conditional test (only runs against a real/MinIO endpoint)**

```ts
// services/headless-artist/src/s3.test.ts
import { describe, it, expect } from 'vitest'
const endpoint = process.env.S3_TEST_ENDPOINT
describe.skipIf(!endpoint)('s3 adapter (MinIO)', () => {
  it('round-trips put → get', async () => {
    const { s3Sink, fetchS3ToLocal } = await import('./s3')
    const cfg = { endpoint, region: 'us-east-1' }
    const manifest = { jobId: 'j', format: 'mp4', byteLength: 4, durationSec: 1, width: 64, height: 48, gpu: false, sha256: 'x', chromiumVersion: 'x', engineVersion: 'y', createdAt: 'now' }
    const loc = await s3Sink({ prefix: 's3://test-out/renders', ...cfg }).deliver('j', new Uint8Array([1,2,3,4]), manifest as never)
    expect(loc).toContain('s3://test-out/renders/j.mp4')
  })
})
```

- [ ] **Step 4: Run (skips without MinIO) + commit**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/s3.test.ts`
Expected: SKIPPED (no `S3_TEST_ENDPOINT`) or PASS against MinIO.

```bash
git add services/headless-artist/src/s3.ts services/headless-artist/src/s3.test.ts services/headless-artist/src/sinks.ts services/headless-artist/src/run.ts
git commit -m "feat(headless-artist): optional S3 reference adapters (input fetch + output sink)"
```

---

## Task 9: Packaging — kit + bundled headless HTML + reference Dockerfile

**Files:**
- Create: `services/headless-artist/scripts/assemble-kit.mjs`
- Modify: `services/headless-artist/package.json` (build wires the bundle copy)
- Create: `services/headless-artist/Dockerfile`
- Create: `services/headless-artist/README.md`

- [ ] **Step 1: Assemble script — bundle CLI + copy the Plan‑1 HTML next to it**

```js
// services/headless-artist/scripts/assemble-kit.mjs
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
execSync('pnpm --filter=@escapesuite/artist run build:headless', { stdio: 'inherit' })
execSync('pnpm --filter=@escapesuite/headless-artist exec esbuild src/cli.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/cli.js', { cwd: root, stdio: 'inherit' })
mkdirSync(resolve(root, 'dist'), { recursive: true })
copyFileSync(resolve(root, '../../apps/artist/dist-headless/headless.html'), resolve(root, 'dist/headless.html'))
console.log('kit assembled in services/headless-artist/dist (cli.js + headless.html)')
```

Update `package.json` scripts:
```json
    "build": "node scripts/assemble-kit.mjs",
    "pack:kit": "node scripts/assemble-kit.mjs && npm pack"
```
And add `"files": ["dist", "README.md"]` so `npm pack` ships only the kit.

- [ ] **Step 2: Build the kit + verify contents**

Run: `pnpm --filter=@escapesuite/headless-artist run build`
Run: `test -f services/headless-artist/dist/cli.js && test -f services/headless-artist/dist/headless.html && echo OK`
Expected: `OK`.

- [ ] **Step 3: Reference Dockerfile (optional turnkey + canonical env)**

```dockerfile
# services/headless-artist/Dockerfile — OPTIONAL reference image / canonical env spec.
FROM mcr.microsoft.com/playwright:v1.58.0-jammy
WORKDIR /app
COPY dist/ ./dist/
COPY package.json ./
ENV HEADLESS_BUNDLE_PATH=/app/dist/headless.html
# License + sink config supplied at run time via env. Runs as non-root 'pwuser'.
USER pwuser
ENTRYPOINT ["node", "dist/cli.js", "render"]
```

- [ ] **Step 4: README — config + Chromium prerequisite + run examples**

Create `services/headless-artist/README.md` documenting: required env (`LICENSE_KEY`, `LICENSE_PUBLIC_KEY`, `HEADLESS_BUNDLE_PATH`, `HEADLESS_GPU`, `HEADLESS_CHROMIUM_PATH`, `HEADLESS_TIMEOUT_MS`), the **pinned Chromium version** + `playwright install chromium` / system-Chromium (`HEADLESS_CHROMIUM_PATH`) options + the OS-dep note (`playwright install-deps`), the job-spec schema, a bare-host run example (`cat job.json | node dist/cli.js render -`), and the container run example (`docker run --gpus all -e LICENSE_KEY=... -v /in:/in -v /out:/out image render --job /in/job.json`).

- [ ] **Step 5: Commit**

```bash
git add services/headless-artist/scripts services/headless-artist/package.json services/headless-artist/Dockerfile services/headless-artist/README.md services/headless-artist/.gitignore
git commit -m "build(headless-artist): assemble kit (cli + bundle), reference Dockerfile, docs"
```

(Create `services/headless-artist/.gitignore` with `dist` and `*.tgz`.)

---

## Task 10: End-to-end one-shot job + license-denied + typecheck/lint

**Files:**
- Create: `services/headless-artist/src/e2e.test.ts`

- [ ] **Step 1: Write the e2e test (spawn the built CLI on a real job)**

```ts
// services/headless-artist/src/e2e.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { TEST_PUBLIC_KEY_HEX, TEST_LICENSE_KEY } from '../../../packages/shared/src/auth/license.testfixtures'

const root = resolve(__dirname, '..')
beforeAll(() => {
  execSync('pnpm --filter=@escapesuite/headless-artist run build', { stdio: 'inherit' })
  execSync('pnpm --filter=@escapesuite/headless-artist exec playwright install chromium', { stdio: 'inherit' })
}, 240_000)

describe('headless-artist CLI e2e', () => {
  it('renders a job to the volume sink (exit 0, output + manifest present)', () => {
    const out = mkdtempSync(resolve(tmpdir(), 'e2e-'))
    const job = resolve(out, 'job.json')
    writeFileSync(job, JSON.stringify({
      jobId: 'e2e-1',
      input: { bundle: { path: resolve(root, 'test/fixtures/project.veditor') } },
      options: { format: 'mp4', quality: 'high' },
      output: { sink: 'volume', config: { dir: out } },
    }))
    const stdout = execFileSync('node', [resolve(root, 'dist/cli.js'), 'render', '--job', job], {
      env: { ...process.env, LICENSE_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX, LICENSE_KEY: TEST_LICENSE_KEY, HEADLESS_BUNDLE_PATH: resolve(root, 'dist/headless.html') },
    }).toString()
    const outcome = JSON.parse(stdout)
    expect(outcome.ok).toBe(true)
    expect(existsSync(resolve(out, 'e2e-1.mp4'))).toBe(true)
    expect(JSON.parse(readFileSync(resolve(out, 'e2e-1.manifest.json'), 'utf8')).sha256).toMatch(/^[0-9a-f]{64}$/)
  }, 240_000)

  it('exits non-zero without a license', () => {
    const out = mkdtempSync(resolve(tmpdir(), 'e2e-deny-'))
    const job = resolve(out, 'job.json')
    writeFileSync(job, JSON.stringify({ jobId: 'd', input: { bundle: { path: resolve(root, 'test/fixtures/project.veditor') } }, options: { format: 'mp4' }, output: { sink: 'volume', config: { dir: out } } }))
    let code = 0
    try {
      execFileSync('node', [resolve(root, 'dist/cli.js'), 'render', '--job', job], { env: { ...process.env, LICENSE_KEY: '', LICENSE_PUBLIC_KEY: '', HEADLESS_BUNDLE_PATH: resolve(root, 'dist/headless.html') } })
    } catch (e) { code = (e as { status: number }).status }
    expect(code).toBe(1)
  })
})
```

- [ ] **Step 2: Run e2e**

Run: `pnpm --filter=@escapesuite/headless-artist exec vitest run src/e2e.test.ts`
Expected: PASS — render exits 0 with output + manifest; license-denied exits 1.

- [ ] **Step 3: Typecheck + lint + full service test run**

Run: `pnpm --filter=@escapesuite/headless-artist exec tsc --noEmit`
Run: `pnpm --filter=@escapesuite/headless-artist run lint`
Run: `pnpm --filter=@escapesuite/headless-artist run test:run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add services/headless-artist/src/e2e.test.ts
git commit -m "test(headless-artist): one-shot CLI e2e (render + license-denied)"
```

---

## Done criteria (Plan 2)

- `pnpm --filter=@escapesuite/headless-artist run build` produces `dist/cli.js` + `dist/headless.html` (the kit); `npm pack` yields a tarball shipping only `dist` + README.
- `node dist/cli.js render --job <spec>` with a valid `LICENSE_KEY`/`LICENSE_PUBLIC_KEY` renders a bundle/manifest job to the configured sink (volume/command/webhook, optional s3), writes a verification manifest, and exits 0; an invalid/missing license exits 1 (fail closed).
- One Ed25519 license implementation shared by browser + Node (no fork); existing browser license tests still pass.
- Chromium is a documented host prerequisite; the runner accepts `HEADLESS_CHROMIUM_PATH` (system Chromium) and GPU via `HEADLESS_GPU`.
- Unit + integration + e2e tests green; typecheck + lint clean.

**Deferred (optional follow-on, per spec §6):** the long-running **HTTP service mode** (`POST /render` + a bounded Chromium pool) — the one-shot CLI is the primary, broker-spawned path, and HTTP can be added later reusing `runJob` unchanged. Also deferred: the hosted-ARTIST "Render on server" UI (companion spec).

**Together with Plan 1**, this delivers the full headless ARTIST: the same engine, license-gated, GPU-capable, transport-agnostic, shipped as an easy-to-transfer kit (container optional).
