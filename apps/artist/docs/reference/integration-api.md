<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Integration API (`src/utils/integration.ts`)
The editor can be embedded in other applications via:
- **PostMessage**: Bidirectional communication with parent window
- **URL parameters**: parsed once at startup by `parseUrlParams()` (later URL changes are ignored; `App` holds the parsed result in state)

Message types: `LOAD_VIDEO`, `LOAD_PROJECT`, `GET_STATE`, `EXPORT`, `SET_THEME`, `GET_THEME` (inbound); `READY`, `VIDEO_LOADED`, `STATE`, `EXPORT_COMPLETE`, `EXPORT_PROGRESS`, `PROJECT_SAVED`, `ERROR`, `THEME_CHANGED`, `THEME_STATE` (outbound)

**Documented but not currently implemented** — these appear in the protocol comment and in the `IntegrationMessage` union, but nothing implements them today; treat them as reserved names, not as a contract a host can rely on:

| Name | Status |
|------|--------|
| inbound `EXPORT` | `App`'s handler has no case for it |
| outbound `EXPORT_PROGRESS` | nothing sends it |
| outbound `PROJECT_SAVED` | nothing sends it |
| `?project=<base64>` | parsed by `parseUrlParams`, never applied |
| `?autoplay=true` | parsed by `parseUrlParams`, never applied |

`sendMessage()` posts to the parent only when `isEmbedded()` (from `@escapesuite/shared/config`) is true; it always dispatches a `videoeditor:message` CustomEvent for same-window hosts. The post is addressed to `?hostOrigin=` when the host supplied a valid one, and to `'*'` otherwise.

**Inbound message filtering**: `initIntegration`'s listener acts only on events whose `event.source` is `window.parent` — the framing window is the only one that drives the editor. When `?hostOrigin=` is set, `event.origin` must match it as well.

**Outgoing `EXPORT_COMPLETE`**: sent from `ExportDialog` right after a successful export (alongside the normal browser download, which is unchanged). Not sent when the export fails or is cancelled.

**Inbound `LOAD_PROJECT` is validated (ESCSUITE-102)**: the payload is the project object itself
(not wrapped in a `data` field), and `useHostIntegration` runs a *present* payload through the
same `parseProject` a dropped `.veditor` file goes through before `setProject` ever sees it — a
host is no better placed than a malformed file to hand a project ARTIST's migration can walk with
no guards. A payload that fails validation is answered with
`{ type: 'ERROR', payload: { message, code: 'INVALID_PROJECT' } }` and the current project is left
untouched, undo history included. An absent (non-object) payload is answered with `INVALID_MESSAGE` (ESCSUITE-232, below).

**Malformed messages get an `ERROR` reply (ESCSUITE-232)**: every inbound type that carries a
payload validates it in `useHostIntegration`, and a malformed one is answered with the protocol's
one error shape, `{ type: 'ERROR', payload: { message, code: 'INVALID_MESSAGE' } }`, `message`
naming the field (`LOAD_VIDEO: payload.url must be a string.`), with nothing fetched or applied.
`LOAD_VIDEO` needs a string `url`; `SET_THEME` a `theme` in the shared `ThemePreference` union
(the shared module exports the type but no runtime list, so the hook keeps a
`satisfies Record<ThemePreference, true>` table that stops compiling if the union changes);
`LOAD_PROJECT` an object — a *parsed-and-refused* project keeps `INVALID_PROJECT`, and an absent,
`null`, string or number payload (which used to be dropped silently) is `INVALID_MESSAGE`.
`GET_STATE` and `GET_THEME` carry no payload. A message with an unknown `type` (`EXPORT`
included) is still ignored without a reply.

**`LOAD_VIDEO` and `?video=` name the file from the URL (ESCSUITE-228)**: `extractFilename(url,
blobType)` takes the URL's last path segment, decoded; a `data:` URL or an empty last segment
(`/clips/`, no path) is "Loaded media". A name with no extension takes one from the blob's MIME type
through a small table (`mp4`, `webm`, `wav`, `mp3`, `m4a`, `png`, `jpg`, `gif`, `webp`; an unlisted
type adds none), a name with an extension keeps it even if the type disagrees, and the stem is
capped at 120 characters. `processMediaFile` (not the name) decides the media type, so an
`audio/wav` URL lands as audio. The `?video=` loop checks the effect's `cancelled` flag after the
fetch and after the probe, as the `?loadVideo=` import does, so StrictMode's first mount adds
nothing and each URL is imported once in development.

**`LOAD_PROJECT` waits for the session question (ESCSUITE-225)**: without `?suppressRestore=1`,
a project that arrives while "Resume Previous Session?" is open (or about to open —
`sessionDecisionPending`, the same gate the `?loadVideo=` placement uses) is parsed at once, so
an invalid payload still gets its `INVALID_PROJECT` reply immediately, but the parsed project is
held in `pendingHostProject` and applied by the effect that drains the pending take once the
question is settled. A second `LOAD_PROJECT` during the wait replaces the first. The host's
project is applied *after* a restore or a decline, because it is the host's explicit, later
instruction and the alternative was a host project silently replaced by "Restore"; when a
`?loadVideo=` take is pending too, the host's project goes first and the take is placed onto it.
With the question already settled it is applied on arrival, as before. `LOAD_VIDEO` is
deliberately not held: it only adds to the media library, and a restore re-adds its own sources
through `addSourceVideo`'s replace-in-place without removing others, so it survives either
answer (pinned in `App.session.test.tsx`).

**`LOAD_VIDEO` and `?video=` fetch through the page's own `connect-src` (ESCSUITE-130)**:
`loadVideoFromUrl` (`utils/integration.ts`) is a plain `fetch(url)`, so both are bound by whatever
Content-Security-Policy the deployment sets — on the hosted deployment (`connect-src 'self'
https://api.vercel.com https://vercel.live` in `vercel.json`) that means a **same-origin URL
only**; a cross-origin one never leaves the page. The browser throws a bare `TypeError: Failed to
fetch` for that refusal, a CORS refusal and an ordinary network failure alike, with no way to tell
them apart from the exception — so `loadVideoFromUrl` catches it, resolves the URL's origin, and
throws a message naming that origin and, when it differs from `location.origin`, the likely
Content-Security-Policy cause (`Could not load the video from <origin>: this deployment does not
allow loading from other origins (Content-Security-Policy), or the server refused the request.`).
A same-origin rejection keeps a plain "the request failed" message — that is an ordinary network
or 404 failure, not a policy one. `useHostIntegration` passes that message on rather than a
generic one: the `?video=` path shows it via `showNotification` (as well as the existing
`console.error`), and inbound `LOAD_VIDEO` both shows it and answers the host with
`{ type: 'ERROR', payload: { message, code: 'LOAD_ERROR' } }` carrying it. A self-hosted or
standalone build fetches under whatever `connect-src` it sets itself, so this only bites the
hosted deployment. See the root `CLAUDE.md`'s "URL params (ARTIST)" bullet.

```ts
{ type: 'EXPORT_COMPLETE', payload: { blob: Blob, format: 'mp4' | 'webm' | 'gif', name: string } }
// name is `${projectName || 'export'}.${format}`
```

**URL parameters**:

| Param | Effect |
|-------|--------|
| `?video=<url>` | Load a video from a URL (repeatable). Fetched from the page itself, so bound by its `connect-src` — same-origin only on the hosted deployment (ESCSUITE-130, see above) |
| `?project=<base64>` | Base64-encoded project state — *documented but not currently implemented* (parsed, never applied) |
| `?autoplay=true` | Start playback once loaded — *documented but not currently implemented* (parsed, never applied) |
| `?loadVideo=<id>` | Load a **take** from IndexedDB (ESCAPECRAFT handoff). The id names the take's primary part; every part of it joins the media library and is placed on the timeline — see "A handed-over take is several files" below |
| `?suppressRestore=1` | Skip the "Resume Previous Session?" prompt. Accepts `1` or `true`. ESCAPEARTIST **neither offers nor writes** the saved session under this flag — the session autosave is switched off too, so a host-driven session leaves storage exactly as it found it. It also neither probes nor holds a tab lock, and New Project clears no slot (ESCSUITE-274), so an embedded editor leaves every tab's saved session where it is |
| `?title=<name>` | Initial project name. Trimmed, capped at 120 chars, trimmed again after the cut, blank ignored. Applied only while the project name is still the default `'Untitled Project'`, so it never overrides a name from `?project=` data or a restored session. `clearHistory()` runs right after, so the host naming the project is not an undo step |
| `?hostOrigin=<origin>` | The host's own origin, e.g. `https://host.example`. **Recommended for production hosts, and required of a host that offers ESCAPECRAFT's "Upload to host" button** (ESCSUITE-176: that message carries a recording's bytes and has no `'*'` fallback). Accepts any `http:`/`https:` value `new URL()` can parse, normalised down to its origin — a trailing slash or a path included; only an unparseable value, one with an opaque origin such as a `data:` URL, or one on any other scheme (a real host is always served over HTTP(S)), is ignored with one console warning. Outbound posts go to it instead of `'*'` wherever one parses, and inbound messages from any other origin are dropped. It protects the **host's** deployment, *not* against being framed — a hostile page that frames the app also controls this URL and would just supply its own origin. Refusing to be framed is `Content-Security-Policy: frame-ancestors` on the deployment serving the app  The hosted deployment sends `frame-ancestors 'self'` (see `vercel.json`); self-hosted builds must set their own. |
| `?tabKey=<name>` | The host's name for this frame (ESCSUITE-332), so two or more editors framed in one host page keep a saved session each. Trimmed, capped at 120 chars, trimmed again after the cut, blank ignored; nothing else is done to it — it only ever becomes part of a storage key and a lock name. **Read only when the editor is embedded** (`isEmbedded()`): the tab id is then `host:<name>`, the same on every load, so the frame's slot is `session:host:<name>` and its locks `escapeartist-tab:host:<name>` / `escapeartist-offer:host:<name>`, and a host reload offers each named frame its own session. Without it an embedded editor's id lasts that page load only — so **every** host should pass one, a single-frame host included: without it a reload loses own-slot-first and Start Fresh leaves the previous load's slot in storage (see "One session slot per tab"). A top-level tab ignores it. Two frames given the **same** name is the host's mistake: the second warns once in the console naming the key and takes an id for that page load, so it overwrites nothing |

#### A handed-over take is several files

`?loadVideo=<id>` names a take's **primary** part. Since ESCSUITE-14 a take recorded with
ESCAPECRAFT's "Record webcam as a separate track" is several `SourceVideo`s sharing a
`takeId` (see the root `CLAUDE.md`'s Data Flow), so the handoff resolves the take before it
does anything with it — `app/takeImport.ts` reads `getAllVideoMetadata()` and hands the list
to `utils/takeParts.ts`'s `orderTakeParts`, which keeps the parts whose `takeId` is the
primary's id. That is the same one equality ESCAPECRAFT groups its library rows by
(`apps/craft/src/utils/takeOrder.ts`). A take with **no** `takeId` — every recording made
before ESCSUITE-14 and every composited PiP take after it — costs no second storage read at
all.

**Every handoff now places clips** (spec decision 7), a single-file take included. It used to
add the recording to the library and leave the timeline empty for the user to drag it onto.
The primary lands on the track a drop from the media library would take — `findEmptyTrack`'s
lowest-index empty one, or a new track at the top if there is none — and each companion on a
new track **above** the one before it, in role order (`ROLE_ORDER` in `utils/takeParts.ts`:
`screen`, `webcam`, `mic`, `system`, so slice 3's audio parts need no ARTIST change). The
*placement* is **one undo step** (ESCSUITE-244 corrected this from "the whole take"): the
library adds are not undoable at all, so the only entry a handoff records is
`store/clipSlice.ts`'s `placeTakeOnTimeline`, which writes every track and every clip in a
single `set` with a single `pushToHistory`. One Ctrl+Z takes the placed clips off the timeline
and leaves every source in the library (Remove takes them out, bytes included); redo places
them again. Each clip sits at the take's start
plus its own `startOffset`, and the take's start is `calculateTimelineDuration` over the clips
already there — so a handoff into a session that already holds work **appends at the end**
rather than landing on top of it; an empty timeline measures 0, so the ordinary import still
starts there and there is no special case for it. An empty list places nothing and records no
undo step, because a take whose every part was missing must not leave an undo step that undoes
nothing.

**The webcam clip's transform is seeded from the take's `overlayPlacement`** (decision 8), so
the import looks like what the user saw while recording and stays editable — which is the
whole point of the separate track. `utils/overlayPlacement.ts` owns the conversion
(`overlayPlacementToTransform`) and is pinned against `Compositor.drawWebcamOverlay`'s own
numbers, with two deliberate differences. The corner inset is `overlayMarginFor(frame.width)`,
which mirrors ESCAPECRAFT's `overlayPaddingFor` (`apps/craft/src/core/overlayGeometry.ts`)
exactly: `DEFAULT_OVERLAY_PADDING` (20 px) below and at `COMPOSITOR_MAX_WIDTH` (1280), and
`frame.width * OVERLAY_MARGIN_FRACTION` (`20 / 1280` of the frame) above it. The compositor caps
its preview canvas **only above 1280** — it never scales a narrower share up — so both halves are
the 20 px the user actually saw: a flat 20 px on a 4K project would put the overlay four times
closer to the edge than it looked, and 20/1280 of a 640-wide share put it 10 px from the edge,
half as far as the preview and the composited MP4 both did (fixed in ESCSUITE-69; the sub-1280
case is pinned in `utils/overlayPlacement.test.ts` against craft's own arithmetic). And the
aspect is the **camera's**, not the compositor's
hard-coded 16:9 box, which stretches a 4:3 picture — the width, which is the size the user
chose, is the compositor's exactly. `x`/`y` are the clip's centre as a fraction of the canvas
and the scale is the drawn width over the part's native width, because that is how
`core/canvasRenderer.ts` reads them: **scale 1 means native pixels**. A part whose stored
dimensions are unusable (nothing ESCAPECRAFT writes) still lands in its corner: the box falls
back to 16:9 and the clip to `DEFAULT_TRANSFORM.scaleX`, which beats a clip zero pixels wide.
The placement's `shape` is **no longer ignored** (ESCSUITE-65): `maskForPlacement` and
`strokeForPlacement` map it and ESCAPECRAFT's white border onto the clip's own `mask` and
`stroke`, beside the transform and from the same one question about whether this part is the
take's camera. The mask's radius is a fraction of the clip's **shorter drawn side** — so it
survives a resolution change — and the stroke's width is a fraction of the **project's** width
carrying craft's 3 px scaled the way `overlayPaddingFor` scales its padding: flat at or below
`COMPOSITOR_MAX_WIDTH`, proportional above it. The handed-over mask is visible on the timeline
as well as in the frame: the webcam clip's thumbnail is clipped to the same circle (see the
Timeline section). Its border is not — the thumbnail shows the shape only.

**The corner is the screen recording's, not the canvas's.** `overlayPlacementToTransform`
takes an optional fourth argument — the **frame**, a rectangle in canvas pixels — and both the
inset and the overlay's width are fractions of `frame.width`. `placeTakeOnTimeline` computes it
from the take's primary: every part imports at native pixels centred on the canvas, so a
1280x720 screen recording in a 1920x1080 project is drawn in a rectangle 320 across and 180
down, and the camera sat in a corner of *that* while recording. Measuring from the canvas
instead would drop the camera over the middle of the picture on every take whose capture is not
the project's own size. The frame defaults to the whole canvas — which is what it *is* when the
two match, and what a primary with no stored dimensions falls back to.

**An audio part carries no picture, and now says so.** A take's microphone and
system-audio companions are stored as `mediaType: 'audio'` with no dimensions at all
(ESCSUITE-14 slice 3), and `TakeClipPart` carries that one field through to the store, where
two decisions turn on it (ESCSUITE-71): such a clip takes `DEFAULT_TRANSFORM`, **always** —
even one that somehow arrived carrying an `overlayPlacement` — and it can never be the
rectangle the webcam corner is measured against, which is the take's first part *with* a
picture rather than `parts[0]`. Both used to be true by accident: an audio part arrives
`0x0`, which fell through to the default transform (right, for a clip nothing ever draws —
`previewGeometry.getOverlayBounds` answers `null` for an audio source) and, had a part ever
arrived before the primary, would have measured the camera against a rectangle that silently
means "the whole canvas". The clip carries the whole default rather than no transform at all
because `Clip.transform` is a required field.

A take's audio need not be a *companion*: since ESCSUITE-143 ESCAPECRAFT stores a
microphone-only recording as its own `mediaType: 'audio'` **primary**, with no screen or webcam
part at all and no `takeId` to resolve — a single-file take, the same shape every
pre-ESCSUITE-14 recording has, except its one file is sound. `importTake` and
`placeTakeOnTimeline` ask nothing about whether a part is the primary or a companion before
giving it the audio treatment above, so the mic-only case needs no code of its own — and
ESCSUITE-148 is the test file pinning that: `takeImport.test.ts`'s single-file audio-only case,
`store/__tests__/projectStore.takePlacement.test.ts`'s single-audio-part placement (default
transform, no mask or stroke, the project resolution untouched, one undo step), and
`VideoUploader.test.tsx`'s pin that the ESCSUITE-117 lazy thumbnail rebuild skips an audio
source outright — it never had a picture to rebuild, so asking storage for one on every mount
was a wasted read the fix removes.

**Every part arrives with its waveform**, computed by the same `extractWaveformData`
(`utils/waveform.ts`) the media library's own import path calls for every file, at the same
point in the sequence — with the library entry, before the take is placed (ESCSUITE-71). It
is *not* only the audio parts: `processVideoFile` gives a video a waveform too, so the
primary's own mixed audio gets one and a handed-over take is not the one import that looks
different. And it had to be done here, because nothing recomputes one: those two import paths
are the only writers of `waveformData`, so a part that arrived without one never got one.

Three rules, and a shape. A part ESCAPECRAFT recorded with `hasAudio: false` is **never
decoded** — that flag is the capture's own answer (ESCSUITE-60/62), the webcam half of a
separate-tracks take having no audio track by construction with the whole mix staying on the
primary. `hasAudio` is **the persisted flag where there is one and the peaks otherwise**
(`part.hasAudio ?? peaks.length > 0`): the extractor's own `hasAudio` is a silence heuristic
and is deliberately not consulted, because it would cost a take recorded in a quiet room the
flag slice 3 persisted *and* leave a pre-ESCSUITE-60 quiet part with no flag at all — which is
peaks `TimelineTrack` would never draw, since it needs the flag **and** non-empty peaks. A
waveform that cannot be read costs the part its waveform and nothing else, exactly like a
thumbnail. The shape is two passes: the storage reads stay serial, part by part, but each
part's waveform is *started* rather than awaited and the library is written after one
`Promise.all` — so a four-part take waits one decode instead of four, while the peaks still
arrive with the entry (one `addSourceVideo` per part, so each part lands in the library without an undo step of its own — the placement is the one step — and it is placed complete).

Three things the import refuses to do, each chosen rather than defaulted:

- **A part whose blob is gone is skipped and counted**, never fatal — storage cleared between
  the two writes, or a companion deleted by hand. A companion whose `getVideo` *rejects* is
  answered the same way: how a part was lost is not the take's business, only that it was, and
  a half-imported take (the primary in the library, nothing on the timeline, a failure toast)
  is worse than a take that arrived a track short and said so. The toast then says
  `Loaded recording: <name> — 1 missing part skipped` (`'info'`) *instead of* the success
  sentence, because `useNotification` is one slot on a three-second timer and two messages
  mean the first is never read. A companion is placed at its own stored length — ESCAPECRAFT
  stores an audio part whose track ended early (a microphone unplugged) at the shorter length its
  file really holds, not the take's (ESCSUITE-318, pinned in `takeImport.test.ts`). A companion
  whose own length cannot be read borrows the take's instead of being left off: the right figure,
  near enough, for a part that ran to the end, and a placeable one for the rest.
  The primary's own path is exempt from both: its blob is already in hand, and a primary whose
  length cannot be resolved still throws, because that is the take failing rather than a part
  of it. A `getThumbnail` that rejects, for any part including the primary, costs that part its
  picture and nothing else — a thumbnail is cosmetic — and if the import throws part-way it
  revokes every thumbnail URL it had made, because its return value is the only way those URLs
  ever escape.
- **A companion with a role this build does not know joins the library and nothing else.**
  IndexedDB is not type-checked; a record written by a newer ESCAPECRAFT is visible and
  deletable rather than placed somewhere arbitrary. (`partRoleRank` answers `Infinity` for such
  a role, which is also what sorts those parts last.)
- **A take any part of which is already in the library is skipped whole** — no re-add, no
  second placement, no notice. That guard predates this work and is what keeps a host
  re-navigating the same id from placing the take twice. It used to ask only about the
  **primary**, which was a hole a user could walk through: delete the primary from the media
  library, re-send the take from ESCAPECRAFT, and the companion — still in the library, so
  re-adding it is idempotent by id — was **placed** a second time, on a second new track
  (ESCSUITE-69). So the question is asked about every part, and asked in `app/takeImport.ts`
  rather than in the hook, because the parts are not known until the metadata scan and the
  refusal has to land before the first write: `importTake` takes an `isInLibrary(id)` lookup
  (the hook lends it `useEditorStore.getState().sourceVideos`, read at call time) and answers
  `alreadyInLibrary`, on which the hook returns without placing or saying anything.
  **The question is asked twice**, because that first one is asked too early to settle it on
  the ordinary path: the library is read when the import's storage reads land, which on a load
  with no `?suppressRestore=1` is *before* `handleRestoreSession` runs
  `session.sourceVideos.forEach(addSourceVideo)`. So a saved session that already holds the
  take got past it and the take was appended a second time — whether the user saw a duplicate
  or a silent skip came down to whether the import lost the race to the prompt click. The
  second check is in `placePendingTake`, at placement time, and asks the **timeline** rather
  than the library: by then the restore has re-added every part it holds, so an id lookup can
  no longer separate "the session already had this take" from "the import just added it", while
  a clip already playing the part can — and is the thing a second placement would duplicate.
  A take dropped there is dropped silently and hands its thumbnail URLs back, the restore
  having re-added its own library entries over the import's.
  The any-part rule has a cost, and it is deliberate: a take whose primary was deleted from the
  library while its companion survived **cannot be re-imported at all** until the companion is
  deleted too. Silence beats a duplicate clip — the library is where a part is visible and
  deletable, so the way back is open, and the alternative is a take the user cannot get rid of
  without noticing it arrived twice.

**The effect that runs the import knows when it is gone.** `useHostIntegration`'s
`?loadVideo=` branch carries an effect-scoped `cancelled` flag, set as the cleanup's first
statement and read twice — after the `getVideo`, where nothing has been created yet and
leaving is free, and after `importTake`, where the parts are already in the library (harmless,
and `addSourceVideo` is idempotent by id) but the timeline and the toast belong to whoever is
still mounted, so that run revokes its own thumbnail URLs and returns. Two things need it:
StrictMode, which every dev build runs (`bootstrapApp` wraps `App` in it) and which would
otherwise place the take twice — the library guard cannot separate the two runs, because the
first is still awaiting storage when the second checks — and an unmount mid-import, which
would otherwise have the cleanup revoke an array that is still empty and land a
`placeTakeOnTimeline` in a project the editor has left.

`LOAD_VIDEO` and `?video=` are **not** take handoffs: they fetch a file from a URL, address no
stored take, and still only add to the library. Both are pinned as placing nothing.

**Placement waits for the restore decision.** ESCAPECRAFT's standalone "Send to Editor" opens
`/artist/?loadVideo=<id>` with **no** `?suppressRestore=1`, so a user with a saved session is
offered "Resume Previous Session?" while the handoff is arriving — and restoring does
`setProject` plus `clearHistory()` (`app/useSessionRestore.ts`), which would replace a take
placed before it and leave no undo step back to it. So the two halves of the import are split:
the parts join the **media library** as soon as they are read (restoring re-adds its own source
videos and `addSourceVideo` is idempotent by id, so nothing there is at risk), while the
**timeline** placement and its toast are held in a ref and drained by a second effect once
`sessionDecisionPending` goes false — whichever way the question was answered. Declining places
the take as usual; accepting restores first and then appends the take after the restored clips
(the append-at-end rule), one undo step, and since the restore's `clearHistory()` has already
run that step still undoes it.

`sessionDecisionPending` is `!sessionRestored`, **not** `showSessionPrompt`, and the difference
is the whole point: for the first moments of a cold load `listSessionStates()` has not come back,
so no prompt is on screen while the question is very much unanswered — and a take placed in
that window is discarded by the "Restore" the user has not been offered yet. `sessionRestored`
(`app/useSessionRestore.ts`) is false from the first render until the question settles one of
five ways: suppressed, nothing stored, the read failed, restored, declined. It is the flag the
session autosave already gates on, and its own doc comment calls it settled-ness; there is no
second flag. Both it and `showSessionPrompt` are `App` component state, so this costs `App` no
store subscription. With the question settled — every `?suppressRestore=1` load included — the
take is placed on the same tick it always was. A host that drives its own state should still
pass `?suppressRestore=1`, which switches the prompt and the autosave off together.

The whole path is pinned by `app/takeImport.test.ts`, `app/useHostIntegration.test.ts`,
`store/__tests__/projectStore.takePlacement.test.ts` and `utils/overlayPlacement.test.ts` /
`utils/takeParts.test.ts`, and end to end by `apps/e2e/tests/escapeartist/take-import.spec.ts`,
which seeds two-part takes straight into the shared database and reads the webcam clip's
corner back out of the inspector — once for a share the size of the project, once for a
1280x720 share in a 1920x1080 project (76% / 75% at 40%, the corner of the centred picture
rather than the canvas's 88% / 87% at 60%) — and, in its last case, restores a seeded session
with one clip on it before answering the prompt, so that the take is seen appending after the
restored clip and coming off again in a single Ctrl+Z. That spec is skipped in WebKit — Playwright's WebKit cannot
store a `Blob` in IndexedDB, the same reason `tests/integration/indexeddb-sharing.spec.ts`
skips there.
