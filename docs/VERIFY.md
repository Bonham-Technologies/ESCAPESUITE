# Verify your download

The offline builds (`ESCAPECRAFT-<version>.html`, `ESCAPEARTIST-<version>.html`, their
`-latest.html` copies) and the headless render kit (`escapesuite-headless-artist-<version>.tgz`)
come from [GitHub Releases](https://github.com/Bonham-Technologies/ESCAPESUITE/releases). Every
release that carries them also carries:

- **`SHA256SUMS.txt`**: the SHA-256 checksum of every other file on that release.
- **A build-provenance attestation** for every file, `SHA256SUMS.txt` included: a signed
  statement from GitHub that this repository's release workflow produced that exact file, and
  from which commit. Signing uses [Sigstore](https://www.sigstore.dev/) through
  [GitHub artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations).
- **An SBOM for every build** (`<build name>.spdx.json`, e.g. `ESCAPEARTIST-<version>.spdx.json`):
  a machine-readable [SPDX 2.3](https://spdx.dev/) list of the open-source packages inside that
  build, with versions, licences and package URLs, and an **SBOM attestation** that ties it to
  the build's exact bytes. See [step 4](#4-check-the-sbom).

Check both before you copy a build onto an isolated network. Releases published before this
check existed (v2.18.27 and earlier) carry neither: if a release has no `SHA256SUMS.txt`, use
a newer one. Releases published before the SBOMs existed carry no `.spdx.json` files.

## 1. Download the file and its `SHA256SUMS.txt` from the same release

Open the release you want and download your file and `SHA256SUMS.txt` into one folder.
Always compare a file against the `SHA256SUMS.txt` **from the release you downloaded it from**.

**About `-latest.html`.** `ESCAPECRAFT-latest.html` and `ESCAPEARTIST-latest.html` are
replaced by a new build with every release. The escapesuite.io download buttons and
`.../releases/latest/download/...-latest.html` always give you the newest one, so its checksum
changes every release. Download it together with
`https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest/download/SHA256SUMS.txt`.
If the check fails, a release may have landed between the two downloads: download both again.
A `-latest.html` file is byte-for-byte the same as the versioned file on the same release,
so you can also keep the versioned name once you have checked it.

The per-package releases (`@escapesuite/craft@<version>`, `@escapesuite/artist@<version>`,
`@escapesuite/headless-artist@<version>`) carry one build each and their own `SHA256SUMS.txt`.
They are built by a different workflow from the `v<version>` release, so the same file name
on the two can have a different checksum. Check each against its own release's sums.

## 2. Check the checksum

Run these in the folder that holds both files. Replace the file name with yours.

**Linux**

```bash
sha256sum -c --ignore-missing SHA256SUMS.txt
```

It prints `ESCAPEARTIST-<version>.html: OK` for each file you downloaded. Anything else
(`FAILED`, or no line for your file) means the file does not match: delete it and download it
again.

**macOS**

```bash
grep ' ESCAPEARTIST-<version>.html$' SHA256SUMS.txt | shasum -a 256 -c
```

It prints `ESCAPEARTIST-<version>.html: OK`.

**Windows (PowerShell)**

```powershell
$file = 'ESCAPEARTIST-<version>.html'
$expected = ((Select-String -Path SHA256SUMS.txt -SimpleMatch "  $file").Line -split '\s+')[0]
$actual = (Get-FileHash $file -Algorithm SHA256).Hash
if ($expected -and $actual -eq $expected) { 'OK' } else { 'MISMATCH: do not use this file' }
```

(`-eq` ignores case, so the upper-case hash from `Get-FileHash` matches the lower-case one in
the file.)

A matching checksum shows the file arrived intact and is the one that release lists. It does
not show who made the release; step 3 does.

## 3. Check the build provenance

You need the [GitHub CLI](https://cli.github.com/) (`gh`), signed in with `gh auth login`. Any
GitHub account works; the repository is public.

```bash
gh attestation verify ESCAPEARTIST-<version>.html -R Bonham-Technologies/ESCAPESUITE
```

It ends with `✓ Verification succeeded!` and names the workflow and commit that built the file.
Any other result means the file was not produced by this repository's release workflow: do
not use it. Run it for each file you downloaded, `SHA256SUMS.txt` included.

To also require the exact workflow that published the file, add `--signer-workflow`:

- `v<version>` releases:
  `--signer-workflow Bonham-Technologies/ESCAPESUITE/.github/workflows/standalone-release.yml`
- per-package `@escapesuite/...` releases:
  `--signer-workflow Bonham-Technologies/ESCAPESUITE/.github/workflows/release.yml`

### On a machine with no internet

`gh attestation verify` normally fetches the attestation from GitHub. To check a file on an
air-gapped machine, fetch what it needs on a connected one first, and carry those files across
with the build:

```bash
# On the connected machine, in the folder with the file:
gh attestation download ESCAPEARTIST-<version>.html -R Bonham-Technologies/ESCAPESUITE
gh attestation trusted-root > trusted_root.jsonl
```

The first command writes `sha256:<digest>.jsonl`, the attestation bundle. On the air-gapped
machine, with `gh` installed:

```bash
gh attestation verify ESCAPEARTIST-<version>.html -R Bonham-Technologies/ESCAPESUITE \
  --bundle sha256:<digest>.jsonl --custom-trusted-root trusted_root.jsonl
```

## 4. Check the SBOM

Each build's SBOM sits next to it on the same release: `ESCAPECRAFT-<version>.spdx.json`,
`ESCAPEARTIST-<version>.spdx.json` and `escapesuite-headless-artist-<version>.spdx.json`. A
`-latest.html` file has the same bytes as the versioned build on that release, so it uses that
build's SBOM. The SBOM lists the production dependencies only (what can end up inside the
build, such as React, Mediabunny and zustand), never the tools used to build or test it. The
headless kit's SBOM lists both the CLI's dependencies and those of the ESCAPEARTIST render
bundle its `headless.html` contains. The CLI's dependencies are Playwright and, marked as an
optional dependency (`OPTIONAL_DEPENDENCY_OF`), `@aws-sdk/client-s3` with its own dependencies:
a plain `npm install` of the kit installs it unless you pass `--omit=optional`.

The `.spdx.json` file is in `SHA256SUMS.txt` and has its own build-provenance attestation, so
steps 2 and 3 check it like any other file. To check that it is the SBOM this repository's
release workflow published **for your build**, verify the build's SBOM attestation:

```bash
gh attestation verify ESCAPEARTIST-<version>.html -R Bonham-Technologies/ESCAPESUITE \
  --predicate-type https://spdx.dev/Document/v2.3
```

It ends with `✓ Verification succeeded!`. To print the attested SBOM and compare it with the
`.spdx.json` file, add `--format json --jq '.[].verificationResult.statement.predicate'`.
`--signer-workflow` works here as in step 3.

Any SPDX tool reads the file, for example `pyspdxtools -i ESCAPEARTIST-<version>.spdx.json`
from [spdx-tools](https://github.com/spdx/tools-python) to validate it, or a vulnerability
scanner such as `grype sbom:ESCAPEARTIST-<version>.spdx.json`.

## 5. How the offline file is locked down

Each offline file (`ESCAPECRAFT-…html`, `ESCAPEARTIST-…html`) carries a Content-Security-Policy
in a `<meta>` tag near the top of the file, before any script. The browser enforces it: the page
may load only what is inside the file itself, and it may not fetch from, connect to or send to
any server, with the exceptions under **What the policy does not block** below. No directive
admits `http:`, `https:`, `ws:`, `wss:` or a host name, and there is no `'self'`.

To read it, run this in the folder with the file (it prints one line, the tag):

```bash
grep -o '<meta http-equiv="Content-Security-Policy"[^>]*>' ESCAPEARTIST-<version>.html
```

On Windows (PowerShell):

```powershell
(Select-String -Path ESCAPEARTIST-<version>.html -Pattern '<meta http-equiv="Content-Security-Policy"[^>]*>').Matches[0].Value
```

You can also open the file in your browser, press Ctrl+U (⌥⌘U on a Mac) to view its source, and
read the tag in the first lines. What the policy allows:

- `default-src 'none'`: anything not listed below is refused, including every `fetch`, XHR,
  WebSocket, font, frame and plug-in.
- `script-src`: the file's own inline scripts, named by their SHA-256 hashes (not
  `'unsafe-inline'`). ESCAPECRAFT also allows `blob:` and `data:` here, for the audio-capture
  module it creates in the page.
- `worker-src blob:` (ESCAPEARTIST): the video decode worker, which is inside the file.
- `connect-src data: blob:` (ESCAPEARTIST): a `?video=` address that carries the video itself.
  A `?video=` address on a server is refused, and the editor says so.
- `style-src 'unsafe-inline'`, `img-src data: blob:`, `media-src blob:`: the file's own styles,
  icons, thumbnails and the recordings and clips you play.
- `base-uri 'none'` and `form-action 'none'`.

Step 2 matters here too: someone who edits the file can remove the tag, and the checksum then
no longer matches.

**What the policy does not block.** A page's Content-Security-Policy governs what the page
itself loads and sends. It does not cover:

- **Going to another page.** The policy does not stop the tab, or a new window, from going to
  another address, such as a link you click. The offline apps show no links to other sites,
  but that is how they are built, not something the policy enforces. Once the tab is on
  another page, that page's own rules apply.
- **Your browser's own traffic.** The browser can still go online for its own reasons:
  updates, safe-browsing checks, sync, crash reports, and, the first time you transcribe in
  ESCAPEARTIST, downloading a speech language pack for the language you picked. The browser
  downloads that pack itself; no page policy covers it. Without a network, transcription works
  only if the pack is already installed.
- **WebRTC.** The policy has no directive for WebRTC peer-to-peer connections, which reach
  other machines without a `fetch`. Neither offline app contains WebRTC code, so only code added
  to the page from outside it, such as an extension's, could open one.
- **Browser extensions.** An extension that can read pages can read this one and make its own
  requests.
- **The rest of your computer.** The policy limits one browser tab. For a machine that must
  not reach a network, disconnect the machine.

CI checks the policy in Chromium on every change: each offline file carries exactly one tag,
before any script, admitting no network source; an injected `fetch`, WebSocket and remote image
are each refused with a `securitypolicyviolation` event; and recording, editing, export (WebM,
MP4 and GIF), the decode worker and transcription (with a stand-in recogniser, as the test
browser has none) run with no violation. Firefox and Safari enforce the same `<meta>` policy,
but CI does not run these checks in them.

## What this does not cover

- The builds are not code-signed with a certificate, and the builds are not reproducible: the
  attestation shows where a file came from, not that rebuilding the source gives the same bytes.
- PR preview builds (the `standalone-release` workflow artifact on a pull request) have no
  checksums file and no attestation. Use a release.

## For maintainers: if a release's verify job fails

Both release workflows check what they have just published:
`standalone-release.yml` (job **Verify Published Release**) and `release.yml` (the last step of
**Attach Standalone Builds**) run `scripts/verify-release-assets.sh`, which downloads the
release and runs both checks above on every asset, then checks that every build has its
`.spdx.json` and an SBOM attestation (step 4). A red result means users cannot verify
that release. Read the job log: it names the file and the check that failed. A transient
failure (GitHub not serving the new release or attestation yet) passes on a re-run of the
failed job. Otherwise fix the cause, delete the release, and re-run the workflow:
`standalone-release.yml` only publishes a `v<version>` release that does not exist yet, and
only from the run for `main`'s head commit.
