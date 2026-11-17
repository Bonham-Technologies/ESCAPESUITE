---
'@escapesuite/craft': patch
'@escapesuite/artist': patch
'@escapesuite/plan': patch
---

The offline ESCAPECRAFT and ESCAPEARTIST files now lock themselves down: each carries a Content-Security-Policy that the browser enforces, so the page can load only what is inside the file and cannot contact any server. In the offline ESCAPEARTIST file, a `?video=` address on a server is now refused with a message saying why; an address that carries the video itself still loads. The Known limitations page and "Verify your download" explain how to read the policy and what it does not cover, such as links you click, the browser's own downloads and extensions.
