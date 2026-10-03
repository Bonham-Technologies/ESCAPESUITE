---
'@escapesuite/shared': patch
---

`parseHostOrigin()` now accepts any `?hostOrigin=` value a URL parser can read on the `http:` or `https:` scheme, and normalises it down to its origin, instead of rejecting anything but a bare origin.

A host that builds its embed URL from `location.href`, or from a routed path, naturally ends up with a trailing slash or a path on the `hostOrigin` it passes in — `https://host.example/` or `https://host.example/app` rather than the bare `https://host.example`. Before this, that value was silently thrown away with one console warning the host operator would likely never see, and ESCAPECRAFT's "Upload to host" fell back to posting the recording's bytes to whatever page happened to be framing it. Now the value is normalised rather than discarded; only a value that cannot be parsed as a URL at all, one with an opaque origin (like a `data:` URL), or one on any scheme other than `http:`/`https:` (such as `ws:` or `file:` — no real host is ever served from one of those), is still rejected, and in that case "Upload to host" refuses to send the recording rather than broadcasting it.
