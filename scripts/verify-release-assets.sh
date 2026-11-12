#!/usr/bin/env bash
# Verifies a published GitHub Release the way a user would (ESCSUITE-401):
# downloads every asset, then checks that
#   1. SHA256SUMS.txt names exactly the release's other assets, no more, no less;
#   2. every asset matches its SHA256SUMS.txt entry (sha256sum -c);
#   3. every asset, SHA256SUMS.txt included, has a build-provenance attestation
#      from this repository (gh attestation verify);
#   4. every build (*.html, *.tgz) has an SPDX SBOM attestation over its digest,
#      and every build but a -latest.html alias has its <name>.spdx.json on the
#      release, while every .spdx.json there names a build (ESCSUITE-430).
# Exits non-zero if any check fails. Both release workflows run it against the
# releases they have just published; docs/VERIFY.md gives users the same steps.
#
# Usage: verify-release-assets.sh <tag> <owner/repo> [<signer-workflow>]
#   <signer-workflow>, e.g. owner/repo/.github/workflows/standalone-release.yml,
#   also requires each attestation to have been signed by that workflow.
# Env: VERIFY_DOWNLOAD_ATTEMPTS (default 6), VERIFY_RETRY_SECONDS (default 10).
# Needs `gh` signed in (GH_TOKEN in Actions) with read access to the repository.
# Tests: scripts/verify-release-assets.test.mjs (pnpm test:scripts).
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: $0 <tag> <owner/repo> [<signer-workflow>]" >&2
  exit 2
fi

TAG=$1
REPO=$2
SIGNER_WORKFLOW=${3:-}
ATTEMPTS=${VERIFY_DOWNLOAD_ATTEMPTS:-6}
RETRY_SECONDS=${VERIFY_RETRY_SECONDS:-10}
SUMS=SHA256SUMS.txt
SBOM_PREDICATE=https://spdx.dev/Document/v2.3

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$@"; }
else
  sha256() { shasum -a 256 "$@"; }
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
assets="$work/assets"

# A release created seconds ago is not always visible to the API yet.
attempt=1
while :; do
  rm -rf "$assets"
  mkdir "$assets"
  if gh release download "$TAG" --repo "$REPO" --dir "$assets"; then
    break
  fi
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "::error::could not download release $TAG from $REPO after $ATTEMPTS attempts"
    exit 1
  fi
  echo "Download of $TAG failed (attempt $attempt/$ATTEMPTS); retrying in ${RETRY_SECONDS}s"
  attempt=$((attempt + 1))
  sleep "$RETRY_SECONDS"
done

cd "$assets"
echo "Release $TAG assets:"
ls -l

if [ ! -f "$SUMS" ]; then
  echo "::error::release $TAG has no $SUMS"
  exit 1
fi

# 1. SHA256SUMS.txt lists exactly the other assets, in coreutils format.
if grep -nEv '^[0-9a-f]{64}  [^ /][^/]*$' "$SUMS"; then
  echo "::error::$SUMS on $TAG has malformed lines (above); expected '<sha256>  <file name>'"
  exit 1
fi
listed=$(sed -E 's/^[0-9a-f]{64}  //' "$SUMS" | LC_ALL=C sort)
present=$(for f in *; do
  if [ "$f" != "$SUMS" ] && [ -f "$f" ]; then echo "$f"; fi
done | LC_ALL=C sort)
if [ "$listed" != "$present" ]; then
  echo "::error::$SUMS on $TAG does not list exactly the release's assets"
  echo "Listed in $SUMS but not on the release:"
  LC_ALL=C comm -23 <(echo "$listed") <(echo "$present") | sed 's/^/  /'
  echo "On the release but not listed in $SUMS:"
  LC_ALL=C comm -13 <(echo "$listed") <(echo "$present") | sed 's/^/  /'
  exit 1
fi

# 2. Every asset matches its checksum.
if ! sha256 -c "$SUMS"; then
  echo "::error::checksum mismatch on $TAG (see FAILED lines above)"
  exit 1
fi

# 3. Every asset has a build-provenance attestation. Check them all before
# failing, so one bad asset never hides the state of the others.
signer_args=()
if [ -n "$SIGNER_WORKFLOW" ]; then
  signer_args=(--signer-workflow "$SIGNER_WORKFLOW")
fi
unattested=()
for f in *; do
  if ! gh attestation verify "$assets/$f" --repo "$REPO" "${signer_args[@]+"${signer_args[@]}"}"; then
    unattested+=("$f")
  fi
done
if [ "${#unattested[@]}" -gt 0 ]; then
  echo "::error::no valid build-provenance attestation on $TAG for: ${unattested[*]}"
  exit 1
fi

# 4. Every build ships with an SBOM and an SBOM attestation over the build.
# A -latest.html alias has the same bytes as its versioned file, so it shares
# that file's SBOM and attestation instead of carrying its own .spdx.json.
builds=()
for f in *; do
  case "$f" in
    *.html | *.tgz) builds+=("$f") ;;
  esac
done
if [ "${#builds[@]}" -eq 0 ]; then
  echo "::error::release $TAG carries no build (*.html or *.tgz)"
  exit 1
fi
sbom_problems=0
for f in "${builds[@]}"; do
  case "$f" in
    *-latest.html) continue ;;
  esac
  if [ ! -f "${f%.*}.spdx.json" ]; then
    echo "::error::$f has no ${f%.*}.spdx.json on $TAG"
    sbom_problems=1
  fi
done
for f in *.spdx.json; do
  [ -f "$f" ] || continue
  stem=${f%.spdx.json}
  if [ ! -f "$stem.html" ] && [ ! -f "$stem.tgz" ]; then
    echo "::error::$f describes no build on $TAG (expected $stem.html or $stem.tgz)"
    sbom_problems=1
  fi
done
no_sbom=()
for f in "${builds[@]}"; do
  if ! gh attestation verify "$assets/$f" --repo "$REPO" --predicate-type "$SBOM_PREDICATE" \
    "${signer_args[@]+"${signer_args[@]}"}"; then
    no_sbom+=("$f")
  fi
done
if [ "${#no_sbom[@]}" -gt 0 ]; then
  echo "::error::no valid SBOM attestation on $TAG for: ${no_sbom[*]}"
  sbom_problems=1
fi
if [ "$sbom_problems" -ne 0 ]; then
  exit 1
fi

echo "Verified $TAG: every asset matches $SUMS and carries a build-provenance attestation from $REPO, and every build an SBOM and its attestation."
