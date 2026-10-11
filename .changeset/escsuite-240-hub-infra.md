---
'@escapesuite/plan': patch
---

The hub's sitemap lists ESCAPECRAFT and ESCAPEARTIST, its hashed assets are cached for a year, and /favicon.ico no longer answers with the hub page.

The sitemap now includes /craft/ and /artist/. The content-hashed files under /assets/ are served with a one-year immutable cache header instead of revalidating on every visit. A request for /favicon.ico is now a real 404 rather than the hub page with a 200.
