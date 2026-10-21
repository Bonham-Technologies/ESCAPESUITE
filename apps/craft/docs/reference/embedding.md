<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Embedding
When CRAFT runs in an iframe (`isEmbedded()` from `@escapesuite/shared/config`),
"Send to Editor" does not open `/artist/` itself — it posts `SEND_TO_EDITOR
{ id }` to the parent window instead, and the host is expected to navigate to
its own editor URL with `?loadVideo=<id>`. Because CRAFT and the host-chosen
editor are same-origin, the shared IndexedDB `video-editor-db` makes the
recorded blob available there without re-uploading it. Outside an iframe,
`VITE_EDITOR_URL` controls where CRAFT opens the editor (defaults to
`/artist/`). See `src/utils/sendToEditor.ts`. Both editor links — "Send to
Editor" and the header's "Open Editor" button — honour `VITE_EDITOR_URL` via
the shared `editorUrl()` helper.

**When the editor is unreachable — opened from disk (`file:`), or an offline build served over http with no absolute editor address — both editor buttons are disabled** (ESCSUITE-221, 259):
`/artist/` would resolve to `file:///artist/`, and the downloaded ESCAPEARTIST file's name is the
user's, so there is no URL to reach. `isFileOrigin()` (`@escapesuite/shared/config`, beside
`isEmbedded()`) decides; the header button and `RecordingsListPanel` (via `RecordingsList`'s
`editorBlockedReason`) keep the button, disable it and show `EDITOR_UNREACHABLE_REASON`
("Download this recording's WebM and import it into the offline ESCAPEARTIST file.") as its title, its
`aria-describedby` target and visible text. A *row's* button is disabled only when not embedded:
embedded, it posts `SEND_TO_EDITOR` and works from any origin; the header button always opens
the editor itself, so it is disabled from disk even embedded. The hosted build is unchanged.

ESCSUITE-259 widened the gate from the protocol to the build and the URL: `editorBlockedReasonFor({ embedded })`
(`src/utils/sendToEditor.ts`, the one reader both the header and `RecordingsListPanel` call) returns the
sentence when `!embedded && (isFileOrigin() || (isStandaloneMode() && editorUrlIsRelative()))`, so the
offline build served from a plain web server (an intranet share) is disabled too, since `/artist/` is a 404
there. `editorUrlIsRelative()` (`@escapesuite/shared/config`, beside `EDITOR_URL`) is true unless
`VITE_EDITOR_URL` is an absolute `http(s)://` URL, so a standalone build given a hosted ARTIST address keeps
its buttons, and a hosted (`saas`) build never blocks over http. The header passes `embedded: false` (its
button opens the editor itself). A sibling-file `?loadVideo=` link to a downloaded ESCAPEARTIST remains
open in the ticket.

**"Upload to host"** is the second host-routed action and the last one: an
extra icon button on every library row, between the MP4 download and "Open in
Editor", which posts `UPLOAD_RECORDING { id, name, blob, role?, takeId?, parts? }` to the
parent — the stored blob itself, by structured clone, with no `arrayBuffer()`
copy and no network of any kind. The three optional fields arrived with
ESCSUITE-14: `role` and `takeId` on a row that has them, `parts` on a take's
primary row, so a host that knows nothing of takes receives exactly what it
received before (see "A take can be several files"). It exists **only** when CRAFT is embedded, because a host
is the only thing that could receive it. `RecordingsListPanel` asks
`isEmbedded()` and passes `onUploadToHost` only then; `RecordingsList` stays
props-only and draws the button exactly when it has the prop, so the component
never asks where it is running. A recording whose bytes are no longer in
storage raises `UPLOAD_UNAVAILABLE` through the app's one notice channel — the
host, not CRAFT, is what would otherwise show the result, so silence would look
like success. See `src/utils/uploadToHost.ts`. No analytics event: what a host
does with its own recordings is the host's business.

**This message never broadcasts (ESCSUITE-176).** `uploadToHost()` returns
`'posted' | 'missing' | 'refused'`, and without a `?hostOrigin=` that
`parseHostOrigin()` can parse it returns `'refused'` and posts nothing at
all — `RecordingsListPanel` reports that with `UPLOAD_NO_HOST_ORIGIN`, the
same shape as `UPLOAD_UNAVAILABLE` for a missing blob but a different fact.
Unlike `sendToEditor`'s id-only post, there is no `'*'` fallback here: this
message carries the recording's **bytes**, and `'*'` would hand them to
whoever happens to be framing the page, possibly after the real host has
navigated elsewhere. The check runs after the missing-blob check (a byteless
row reports as missing whatever `hostOrigin` says) and before the take's other
parts are read, so a refused upload cannot cost CRAFT the companion reads.

The header's **"Open Editor" button is deliberately not routed through the
host**: embedded or not, it opens the editor itself. Only "Send to Editor" and
"Upload to host", which hand over one specific recording, become messages.

**`?hostOrigin=<origin>`**: when the host names its own origin on CRAFT's URL,
both host-routed posts — `SEND_TO_EDITOR` and `UPLOAD_RECORDING` — are
addressed to that origin instead of `'*'`. **It is required, not merely
recommended, for a host that offers "Upload to host"**: `SEND_TO_EDITOR`'s
`'*'` fallback hands an arbitrary framer an opaque id it cannot resolve (the
database is same-origin to CRAFT) and keeps that fallback, but
`UPLOAD_RECORDING` does not — see above. A deployment that ships this action
wants both — its own origin here, and `frame-ancestors` below. The value need
not be a bare origin (ESCSUITE-176): `parseHostOrigin()` accepts anything
`http:`/`https:` `new URL()` can parse and normalises it down to `.origin`, so
a trailing slash or a path — as naturally arrives from `location.href` or a
routed URL as a typed-by-hand origin would — is accepted rather than silently
degrading the post. Only a value `new URL()` cannot parse at all, one with an
opaque origin (such as a `data:` URL), or one on any other scheme (checked
explicitly rather than via the opaque-origin test alone, because Chromium
serialises a `file:` URL's origin as the non-opaque string `'file://'`) is
ignored, with one console warning; for `SEND_TO_EDITOR` that still means the
`'*'` fallback, and for `UPLOAD_RECORDING` it means the refusal above. The parser is
`parseHostOrigin()` in `@escapesuite/shared/config`, shared with ESCAPEARTIST.
It protects the **host's** deployment, not against being framed — a hostile
page that frames CRAFT also controls this URL. Refusing to be framed is
`Content-Security-Policy: frame-ancestors` on the deployment serving CRAFT. The hosted deployment (escapesuite.io) sends `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN` from `vercel.json`, so it cannot be framed by other origins; a self-hosted or standalone build must set its own.

**Behaviour change for existing embedders**: CRAFT in *any* iframe now posts
`SEND_TO_EDITOR` rather than opening a tab. A host that previously relied on
the `window.open()` popup — including one that embedded CRAFT incidentally,
without meaning to integrate — will see no new tab and must listen for the
message and navigate to its own editor itself.
