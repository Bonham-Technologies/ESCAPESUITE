---
'@escapesuite/plan': patch
---

The download buttons now fetch the latest offline build directly. "Download the
offline build" used to point at GitHub's bare "latest release" listing, which
can resolve to any per-package release a version bump creates — including one
with no offline build attached at all, for as long as it takes the next real
build to land. The open-source section's button is now two per-app buttons,
"Download ESCAPECRAFT" and "Download ESCAPEARTIST", each pointed at a stable
asset URL that always resolves to that app's latest build; the hero keeps a
secondary "All downloads" link to the GitHub releases page for anyone who
wants to browse everything instead.
