---
'@escapesuite/shared': patch
---

`parseHostOrigin()` now warns when an embedding host passes an empty `?hostOrigin=` value, instead of silently treating it the same as no value at all.

A bare `?hostOrigin=` or a valueless `?hostOrigin` — the shape a host produces when it interpolates an `undefined` variable into the iframe URL — used to return `null` with no console warning, even though the function's own doc comment promises one for every value it can't use. It is now treated like any other invalid `hostOrigin` and logs the same one-per-page-load `console.warn` naming the problem, so a misconfigured host is noticed instead of silently losing the targeted `postMessage` traffic. A host that never passes the parameter at all is unaffected and still gets silence. Also deleted four long-unused exports from the package's root barrel (`ESCAPE_SUITE_VERSION`, `SHARED_DB_NAME`, `isBrowser`, `isProduction`) that had no importer anywhere in the monorepo.
