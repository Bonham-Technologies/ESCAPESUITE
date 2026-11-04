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

Check both before you copy a build onto an isolated network. Releases published before this
check existed (v2.18.27 and earlier) carry neither: if a release has no `SHA256SUMS.txt`, use
a newer one.

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

## What this does not cover

- The builds are not code-signed with a certificate, and the builds are not reproducible: the
  attestation shows where a file came from, not that rebuilding the source gives the same bytes.
- PR preview builds (the `standalone-release` workflow artifact on a pull request) have no
  checksums file and no attestation. Use a release.

## For maintainers: if a release's verify job fails

Both release workflows check what they have just published:
`standalone-release.yml` (job **Verify Published Release**) and `release.yml` (the last step of
**Attach Standalone Builds**) run `scripts/verify-release-assets.sh`, which downloads the
release and runs both checks above on every asset. A red result means users cannot verify
that release. Read the job log: it names the file and the check that failed. A transient
failure (GitHub not serving the new release or attestation yet) passes on a re-run of the
failed job. Otherwise fix the cause, delete the release, and re-run the workflow:
`standalone-release.yml` only publishes a `v<version>` release that does not exist yet, and
only from the run for `main`'s head commit.
