<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Integration API (embedding CRAFT / ARTIST in a host page)
Both tools detect embedding with `isEmbedded()` (`packages/shared/src/config`) — true whenever
`window.parent !== window` — and talk to the host over `postMessage`. The full protocol lives in
the doc comment at the bottom of `apps/artist/src/utils/integration.ts`.

- **PostMessage**: bidirectional communication with the parent window. ARTIST posts `READY` on
  init, and `EXPORT_COMPLETE` with
  `{ blob: Blob, format: 'mp4' | 'webm' | 'gif', name: string, audio?: boolean }`
  after a successful export (`name` is the download filename; not sent on failure or
  cancellation). `'gif'` is additive (ESCSUITE-34): a host that handles the two video formats sees
  a new value of a field it already reads, and needs no change unless it wants to treat a GIF
  differently. `audio` is additive too (ESCSUITE-175) and says whether the file carries an audio
  track: `false` for every GIF (no audio track in the container), for an MP4 exported in a browser
  with no AAC encoder (Firefox 155 today) and for a WebM exported in one with no Opus encoder;
  `true` otherwise. Read it as "this file has no audio track", **not** as "the project's sound was
  dropped" — a silent project exported in a no-AAC browser also reports `false`, because the
  exporter does not decode the sources and cannot tell the two apart (the editor's own completion
  notice pairs the field with its own "did this project have any sound" check before claiming a
  loss). A host that ignores the field is unaffected; a host that reads it should treat a missing
  field as `true`, which is how every message sent before the ticket behaved.
  Inbound `LOAD_VIDEO` (`{ url }`) fetches that URL the same way `?video=` does, so it is bound by
  the same `connect-src` — a URL the page's policy refuses gets an `ERROR` reply naming the origin
  and the policy (`code: 'LOAD_ERROR'`) instead of a generic failure. See "URL params (ARTIST)"
  below and ESCSUITE-130.
- **CRAFT → host**: `{ type: 'SEND_TO_EDITOR', payload: { id } }` when embedded, instead of the
  `window.open()` it uses standalone. `id` addresses the recording in the shared IndexedDB.
  CRAFT's header "Open Editor" button is deliberately *not* routed through the host — it still
  opens the editor itself when embedded. Only "Send to Editor" and "Upload to host" become
  messages.
- **CRAFT → host (upload)**: `{ type: 'UPLOAD_RECORDING', payload: { id, name, blob, role?, takeId?, parts? } }` from a
  per-row "Upload to host" button that exists **only** when CRAFT is embedded — the host is the
  only thing that could receive it. The `Blob` goes by structured clone, so a host that cannot
  reach the shared IndexedDB (or would rather not) gets the file itself. `RecordingsListPanel`
  decides with `isEmbedded()`; `RecordingsList` is props-only and draws the button exactly when
  it is given `onUploadToHost`. See `apps/craft/src/utils/uploadToHost.ts`.
  Since ESCSUITE-14 a take can be several files, and the payload says so two ways. `role` and
  `takeId` (both optional, both absent on a take recorded as one file) name **which** part a row's bytes
  are. And the primary row's message carries `parts` — every file of the take, the primary
  included, in role order:
  `parts?: Array<{ id: string; role: 'screen' | 'webcam' | 'mic' | 'system'; name: string; blob: Blob; startOffset: number }>`.
  `startOffset` is seconds after the take's start at which that part's first frame was captured
  (0 for every part ESCAPECRAFT records today — one recorder, one clock). A part whose bytes are
  gone is left out rather than listed with nothing in it.

  **Adopting `parts`.** It is additive and nothing about the existing fields moved.
  - *An older host* reads `payload.id`, `payload.name` and `payload.blob` and gets exactly what
    it has always got: the **screen** part's bytes, under the take's name. It never sees `parts`
    and needs no change. Every host that shipped against slice 1 keeps working.
  - *A new host* reads `payload.parts` when it is there and falls back to `payload.blob` when it
    is not — `parts` is **absent** for a take that is one file, so `payload.parts ?? [{ id,
    name, blob, role: 'screen', startOffset: 0 }]` is the whole adoption. Each entry's `id`
    addresses the same record in the shared IndexedDB that `payload.id` does.
  - *Message size* is not a concern: a `Blob` crosses a structured clone as a handle, not a
    copy, so a four-part take's message is four references and the primary appearing in both
    `blob` and `parts[0]` costs nothing — they are literally the same `Blob` object, because
    `uploadToHost` hands the bytes it already holds to `loadTakeParts` rather than letting it
    read them again. The bytes are never read into the heap on either side.
  - *The per-row buttons stay.* A companion row's own "Upload to host" still posts that row
    alone, with `role` and `takeId` and no `parts`. It is redundant for a host that adopted
    `parts` and is the only way a host that has not can be handed one specific part.
- **URL params (ARTIST)**: `?video=url` to preload, `?project=base64` for state,
  `?loadVideo=<id>` for the CRAFT handoff — the id addresses a take's **primary** part, and
  ARTIST resolves its siblings by `takeId`, adds every part to the media library and places
  them on the timeline in one undo step: the primary on a video track, the webcam on a track
  above it at its `startOffset` with its transform, its **mask** and its **border** all
  seeded from the primary's `overlayPlacement` (ESCSUITE-65: a `'circle'` placement arrives as
  `clip.mask = { kind: 'circle' }` and ESCAPECRAFT's white border as `clip.stroke`, carried at
  the weight the *capture* had rather than the project's — visible in the preview, in an export,
  and as the shape of that clip's thumbnail on the timeline), and the audio parts on tracks of
  their own. Placement happens for
  **every** handoff, a single-file take included (ESCSUITE-14 decision 7); a handoff into a
  session that already holds clips appends at the end of the timeline —
  `?suppressRestore=1` to skip the
  "Resume Previous Session?" prompt (ARTIST then neither offers nor writes the saved session —
  the autosave is off too), `?title=<name>` to name the project (trimmed, max 120 chars;
  applied only while the name is still the default `Untitled Project`), and `?tabKey=<name>` to
  name the frame — **every** host that frames ARTIST should pass one, whether it frames one editor or
  several (ESCSUITE-332, below). `?video=url` (and the
  inbound `LOAD_VIDEO` message, below) fetch the URL from the page itself, so both are bound by
  its own `connect-src` — on the hosted deployment (`connect-src 'self' ...` in `vercel.json`)
  that means a **same-origin URL only**; a cross-origin one is refused before it leaves the page,
  and `loadVideoFromUrl` says so by naming the origin and the likely Content-Security-Policy
  cause, rather than a bare `Failed to fetch` (ESCSUITE-130). A self-hosted or standalone build
  fetches under whatever `connect-src` it sets itself. The same policy's `script-src` carries
  `blob:` (ESCSUITE-299): ESCAPECRAFT loads its AudioWorklet audio-capture module from a `blob:`
  URL, a worklet module is fetched under `script-src`, and without it every hosted take would
  quietly fall back to the ScriptProcessorNode capture. It admits nothing an injected script could
  not already do under the policy's `'unsafe-inline'`. The offline single-file build has no policy
  and no origin: opened from `file://`, its module URL is `blob:null/…`, which Chromium's worklet
  loader refuses, so the capture retries the same module as a `data:text/javascript` URL and only
  then falls back (ESCSUITE-317; `blob:` stays first so the hosted policy never has to admit `data:`). Pinned by
  `apps/e2e/tests/production/csp-audio-worklet.spec.ts` (under the served policy, and its inverse)
  and by `serve-dist.test.mjs`'s drift guard; a self-hosted build that sends its own policy needs
  the same.
- **`?hostOrigin=<origin>`** (both apps): the host's own origin, e.g. `https://host.example`.
  Recommended for production hosts — and **required** of a host that offers CRAFT's "Upload to
  host" (ESCSUITE-176): that message carries the recording's **bytes**, not just an id, and
  `uploadToHost()` never broadcasts them to `'*'` — without a `hostOrigin` it can parse, it
  posts nothing at all and says so through CRAFT's one notice channel. `SEND_TO_EDITOR`'s
  id-only post is the one exception that keeps its `'*'` fallback: an opaque id is useless to a
  framer that cannot reach the shared IndexedDB, whereas a recording's bytes are not. Outbound
  posts are addressed to `hostOrigin` instead of `'*'` wherever one parses, and ARTIST ignores
  inbound messages from anywhere else. It protects the **host's** deployment, not against being
  framed — a hostile page that frames the app also controls the URL and would supply its own
  origin; refusing to be framed is `Content-Security-Policy: frame-ancestors` on the deployment.
  Parsed by `parseHostOrigin()` in `packages/shared/src/config`, which accepts any `http:`/
  `https:` value `new URL()` can parse and normalises it down to its origin — a trailing slash
  or a path included — rather than rejecting anything but a bare origin; only a value `new URL()`
  cannot parse at all, one with an opaque origin (a `data:` URL, say), or one on any other scheme
  (the http(s)-only check is explicit rather than relying on the opaque-origin check alone,
  because Chromium serialises a `file:` URL's origin as the non-opaque string `'file://'`) is
  ignored, with one console warning. The hosted deployment (escapesuite.io) sends `frame-ancestors 'self'` plus
  `X-Frame-Options: SAMEORIGIN` from `vercel.json`, so it cannot be framed by other origins; a
  self-hosted or standalone build must set its own.
- **`?tabKey=<name>`** (ARTIST): the host's name for this frame, so two or more editors framed in
  one host page keep a saved session each (ESCSUITE-332). **Every host should pass one — a page that
  frames a single editor included — and a different one to each frame** when it frames several: every same-origin frame of a page shares the top-level
  tab's `sessionStorage`, where a top-level tab keeps its id, so before this ticket the second frame
  renewed the first's id and wrote over it, and after a host reload the two frames swapped sessions
  (ESCSUITE-311's two-iframes probe). Trimmed, max 120 chars, blank ignored, otherwise taken as it
  comes — it is only ever part of a storage key and a lock name. Read only when embedded
  (`isEmbedded()`): the frame's id is `host:<name>`, its slot `session:host:<name>` and its locks
  `escapeartist-tab:host:<name>` / `escapeartist-offer:host:<name>`, so each named frame is offered
  its own session after a host reload. **An embedded editor never reads or writes the shared
  `sessionStorage` id**, with a key or without: without one its id lasts that page load, so nothing
  is overwritten or lost, but after a host reload each frame's last session is offered like any
  closed tab's — newest free first, to whichever frame asks — and that is the cost a single-frame
  host pays too: it loses own-slot-first across a reload, and because that slot now counts as another
  tab's, Start Fresh leaves it in storage and remembers the save as declined (ESCSUITE-306) instead of
  deleting it, so a keyless host whose user reloads and starts fresh piles up one slot per reload
  until the 30-day prune, each holding its sources off ESCSUITE-268's reclaim list for that long. Two frames given the **same** key is the
  host's mistake: the second warns once in the console naming the key and takes an id for that page
  load, overwriting nothing. The frames of one page share the declined-session list
  (`declinedSlots.ts`, also `sessionStorage`): a save declined in one is not offered to another. A
  top-level tab ignores the parameter. Pinned in a real two-iframe host page by
  `apps/e2e/tests/integration/two-iframes-session.spec.ts`; see `apps/artist/CLAUDE.md`'s "One
  session slot per tab".
- **Documented but not currently implemented**: inbound `EXPORT`, outbound `EXPORT_PROGRESS` and
  `PROJECT_SAVED`, and the `?project=` / `?autoplay=` URL params. See `apps/artist/CLAUDE.md`.
- **`VITE_EDITOR_URL`** (build-time, CRAFT): where standalone CRAFT opens the editor.
  Defaults to `/artist/`; normalised to a single trailing slash.
- Proved end to end in a real iframe by `apps/e2e/tests/integration/host-embedding.spec.ts`.
