# Security Policy

## Supported Versions

ESCAPE Suite is distributed as a hosted static site ([escapesuite.io](https://escapesuite.io))
and as offline single-file builds attached to
[GitHub Releases](https://github.com/Bonham-Technologies/ESCAPESUITE/releases).
Only the latest release and the current `main` branch receive security fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

- Preferred: report privately via
  [GitHub Security Advisories](https://github.com/Bonham-Technologies/ESCAPESUITE/security/advisories/new)
- Or email: **security@escapesuite.io**

Include reproduction steps and the build you tested (hosted or offline, plus
version). You should hear back within a few business days; please allow a
reasonable window for a fix before public disclosure.

## Scope notes

ESCAPE Suite runs entirely client-side — there is no backend, no accounts, and
no server-side data handling. Reports about the browser apps (XSS, CSP bypass,
supply-chain issues in the build pipeline, IndexedDB data exposure) are all in
scope.
