<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# App (`src/App.tsx`)
`App.tsx` is wiring only — the seven `useState` calls the JSX and the hooks need, the store selectors, nine
hook calls, the handful of inline lambdas the JSX needs and the composition itself. It binds no listener, holds
no timer, and computes nothing; every effect, every disk and session write, and every piece of
chrome lives in one module each under `src/app/`.

**`main.tsx` wraps `App` in `@escapesuite/shared`'s `ErrorBoundary`**, via `bootstrapApp()`
(ESCSUITE-212), so a render-time throw anywhere below shows that package's own minimal fallback
panel instead of unmounting the whole app to a blank page. ARTIST holds no live *capture* — no
camera or microphone light, no `getDisplayMedia` stream — but an export in flight owns things a
crash would leave running (a `decodeWorker` Web Worker, one or two WebCodecs encoders, a muxer),
whose only release paths are the export's own completion, failure and Cancel. So since
ESCSUITE-220 `main.tsx`'s `onError` calls `disposeLiveExport()` (`components/Export/liveExport.ts`,
a module with no React in it so `main.tsx` imports no component): `ExportDialog` registers each
run's `AbortController` in a module-level slot when the run starts and clears it when that run
settles (its `finally`) or is cancelled (`handleCancel`), the clear guarded by identity so a
cancelled run settling late cannot drop the run started after it; `disposeLiveExport()` empties
the slot and aborts what was in it, so it aborts at most once and is a no-op with nothing
exporting or after Cancel. The abort reaches the exporter through its signal, and the exporter's
own abort path releases the encoders, the muxer and the worker exactly as Cancel does. The shape
is ESCAPECRAFT's `disposeLiveRecordingSession`, and so is the ordering it relies on: the slot
still names the run when `componentDidCatch` calls `onError` (the dialog has no unmount path that
touches it), pinned under the real boundary by `ExportDialog.test.tsx`'s ordering case. Before
the ticket this was a deliberate no-op that let an export run on behind the error panel until
Reload. The boundary's own `componentDidCatch` already logs the error to the console in dev.

**The hooks are called in a fixed order, and the order is the behaviour.** The order the hooks
are called in is the order their effects run in, and it is the order the six effects ran in
when they were all inline in this file: theme → session check → autosave → keydown → timeline
resize → host integration. The three hooks that bind no effect (`useNotification`,
`useProjectActions`, `useTimelineZoom`) sit where their results are first needed. Two of those
positions are load-bearing rather than tidy: `useSessionRestore` writes the `sessionRestored`
flag `useSessionAutosave` gates on, so registering the autosave any earlier would change which
render first arms the debounce (`App.session.test.tsx`'s "writes nothing before the debounce
elapses" and "clears the pending write on unmount" are the net) — and, since ESCSUITE-274, would
queue this tab for its own tab lock before the restore check had asked whether a live tab already
holds this tab's id; and `useThemeLifecycle` runs ahead of everything else, so the document is already themed by
the time the editor mounts below it. ESCSUITE-227 gave `useSessionAutosave` a second effect —
since ESCSUITE-274 the hold on this tab's own lock — registered right after its debounce, so the
autosave's effects are the third and fourth and every hook after it moved down one (keydown fifth,
timeline resize sixth, host integration seventh). `useProjectActions`, which binds no effect, moved
from third to fifth in the call order — right after the autosave, whose `clearSession` New Project
calls (ESCSUITE-227 fix round 1, ESCSUITE-274).

**One session slot per tab (ESCSUITE-274, after ESCSUITE-227).** Before ESCSUITE-227 every
ESCAPEARTIST tab of one origin shared one autosave row — `settings` / `current-session` in
`video-editor-db` — so a second tab was offered the first tab's *live* work as "Resume Previous
Session?" and, on Start Fresh, threw it away. ESCSUITE-227 made one tab at a time own that row
through a session-wide Web Lock; what it left was a crash: the owner's lock released, the next tab
became the owner, and its next edit overwrote the crashed tab's session. ESCSUITE-274 gives every
tab a slot of its own, and the session-wide lock, `ownsSession` and `SESSION_HELD_NOTICE` are gone
(the situation the notice described — a tab that may neither offer nor save — no longer exists).
Five rules now hold:

- **A tab id per tab.** `app/tabId.ts`'s `readTabId()` returns the id kept in `sessionStorage`
  under `escapeartist-tab-id`, or mints one (`crypto.randomUUID()`, or 128 bits of `crypto.getRandomValues` as hex outside a
  secure context, where `randomUUID` does not exist) and keeps it there.
  `sessionStorage` belongs to one tab and survives a reload, so a reloaded tab finds its own slot
  again and a new tab gets a new one; where `sessionStorage` throws (a sandboxed frame) the id lasts
  for the document only. `useSessionRestore` owns the id (`useState(() => readTabId({ embedded:
  isEmbedded(), tabKey }))`, read once per mount) and returns it; `App` hands it to
  `useSessionAutosave`. `SessionState` carries `tabId`.
  **An embedded editor never reads or writes that key** (ESCSUITE-332). `sessionStorage` belongs
  to the *top-level* tab, so every same-origin frame in one host page shares it: before this ticket
  a second ESCAPEARTIST frame read the first frame's id, found its tab lock held, renewed — and wrote
  its new id over the shared key, so after a host reload both frames started from that one id and
  swapped sessions, whichever startup check ran first keeping it (ESCSUITE-311's two-iframes probe
  measured it). In a frame, `readTabId({ embedded: true, tabKey })` answers `host:<tabKey>` when
  the host named the frame with `?tabKey=` — the same id on every load, so each named frame keeps
  its own slot (`session:host:<tabKey>`, no new storage shape) and locks across a host reload — and
  an id minted for this page load when it did not. **The trade without a key:** a host reload gives
  each unnamed frame a fresh id, so its last session is no longer its *own* slot but a departed
  tab's, offered newest free first like any other — nothing is lost, but which frame is offered
  which save is no longer kept. That applies to a host that frames **one** editor too, which is why
  every host should pass a `tabKey`: a keyless single frame loses own-slot-first across a host
  reload, and its previous load's slot — another tab's, by the ESCSUITE-306 rule — is not deleted by
  Start Fresh but left in storage and remembered as declined, one slot per reload until the 30-day
  prune, its sources off ESCSUITE-268's reclaim list meanwhile. `renewTabId({ embedded: true, tabKey })` stays in memory too, and a
  `host:` id is **never renewed into another one**: when the startup probe finds `host:<tabKey>`
  held, a second frame was given the same key — the host's mistake — so the frame warns once in
  the console naming the key and takes an id for this page load, overwriting and losing nothing.
  The no-argument forms are a top-level tab's, unchanged. A frame's **declined list**
  (`declinedSlots.ts`, below) is deliberately left in the shared `sessionStorage`: the frames of one
  host page share it, so a save declined in one frame is not offered to the other either — the user
  turned that save down, and each named frame is offered its own slot first regardless.
- **One row per tab.** `core/storage.ts`: `saveSessionState(session)` writes `session:<tabId>`
  (through `@escapesuite/shared/storage`'s `setSetting`); `listSessionStates()` returns every slot
  as `{ tabId, session }` — the `session:*` rows through the shared `listSettings(prefix)` (an
  `IDBKeyRange` over the prefix), the tab id taken from the row's key, then the legacy
  `current-session` row if one is left, as `tabId: null`, a slot with **no owner**;
  `clearSessionState(tabId)` removes one row, and `clearSessionState(null)` the legacy one. Nothing
  writes the legacy row any more: it is offered as-is and deleted when restored, declined or pruned
  (another tab's declined slot is left, ESCSUITE-306 — the legacy row has no tab to come back for it).
  (The Playwright suites that seed a session for the prompt — `components.spec.ts`,
  `accessibility/core.spec.ts`, `take-import.spec.ts`, `host-embedding.spec.ts` — still seed that
  legacy row, which is exactly the shape a user upgrading from an older build has.)
- **Each tab holds its own lock, and a slot is offered only when its tab is gone.**
  `app/sessionLock.ts`: `holdTabLock(tabId, locks?)` requests the exclusive lock
  `escapeartist-tab:<tabId>` and holds it until the returned release runs (the autosave's effect
  cleanup) or the page goes away — a lock dies with its page, so a closed *or crashed* tab's lock is
  free. A request released before it was granted (StrictMode's cleanup-then-remount, the id changing
  under a duplicated tab) lets go the moment it is handed the lock. `probeTabLock(tabId, locks?)`
  asks the same name with `ifAvailable: true` and answers `'held'` when the callback is handed
  `null`. Both take the `LockManager` as an argument (default `navigator.locks`) so the tests hand in
  `src/test/doubles/locks.ts`; where the browser has no Web Locks, or the lock manager *rejects*
  (`SecurityError` on an opaque origin — a sandboxed frame, or `file://` in an engine that treats it
  as opaque), every tab answers as if it were alone: the probe says `'free'` and logs, the hold
  logs and holds nothing. Over plain http (not a secure context) the browser exposes no Web Locks
  at all, so there every tab answers alone and a live tab's slot can be offered to another tab.
  `app/sessionSlots.ts`'s `findOfferableSlot(tabId, now)` lists every slot and deletes (not
  awaited, a failure logged) any whose `timestamp` is older than `SESSION_SLOT_MAX_AGE_MS`
  (`appConstants.ts`, 30 days — exactly 30 days is kept). Then **this tab's own slot comes first**
  whenever it exists (ESCSUITE-274 fix round 1): it is this tab's own session after a reload or a
  browser crash-restore — tabs the browser brings back with their `sessionStorage` start together,
  before any has its lock again, so each finds every other's slot free — and offering another
  tab's newer slot over it would lose it either way (a restore adopts over it; a decline leaves it
  for this tab's next edit to overwrite). It is offered without a probe — this tab is about to hold
  that lock itself, and a probe would call it `'held'` — and an own slot with no source in it offers
  nothing rather than another tab's slot. Only a tab with **no slot of its own** is offered someone
  else's: of the slots with a source in them (the prompt never offered one without), newest first,
  the first that is the legacy row (no probe, no claim — no tab owns it) or whose tab lock
  `probeTabLock` finds `'free'` **and** whose offer this tab manages to **claim** (ESCSUITE-283).
  `claimOfferLock(tabId, locks?)` asks for a lock of its own, `escapeartist-offer:<tabId>`, with
  `ifAvailable: true` and, when it is granted, keeps it, resolving to the function that lets it go
  (`null` when another tab already holds that offer, and nothing is taken). The claim is held while
  the slot is on offer, so a second fresh tab asking at the same moment finds the offer held and
  moves on to the next slot, or is offered nothing. It is deliberately **not** the departed tab's
  own `escapeartist-tab:<tabId>` (ESCSUITE-283 fix round 1): that lock means only "this tab is
  alive", and holding it for an open prompt made the departed tab, coming back — a reload after a
  renderer crash, a background tab the browser restores lazily — find its own id held, take itself
  for a duplicate, renew its id and lose its slot to the other tab's prompt. With the offer apart,
  it finds its id free, keeps it, and is offered its own slot first. Where Web Locks are missing or
  reject, the claim answers as a lone tab — a release that does nothing — as the probe does. A slot
  with clips but no source (text-only work) is written but never offered, so it lingers until its
  own tab's New Project or the age limit — the same source-only rule the single slot had, now per
  tab.
- **The startup check, in order.** `useSessionRestore`'s effect first probes **this tab's own id**,
  synchronously as the effect runs and so before the autosave's `holdTabLock` a hook later (asked
  the other way round, the probe would find this tab's own queued request): `'held'` means a live
  tab already has this id — a browser copies `sessionStorage`, id and all, into a duplicated tab —
  so this tab calls `renewTabId()` and `setTabId` and takes an id of its own, and the original's
  live slot's lock is then asked for like any other and found held, and the slot skipped. Then `findOfferableSlot` decides the prompt;
  the offered slot is kept in `offeredSlotRef`. The check starts once per mount
  (`checkStartedRef`): StrictMode runs the effect twice, and a second probe of this tab's own lock
  would find the first one's momentary hold. `?suppressRestore=1` neither probes nor holds.
- **What happens to a slot.** It is removed when its session is **restored** — the restoring tab
  adopts it, `adoptSessionSlot(slot, tabId)` writing the session again under this tab's id, stamped
  now (so the age limit counts from the restore), and only then deleting the old row, so a failed write leaves it where it was (not awaited, a failure
  logged; this tab's own slot, after a reload, is not rewritten); when it is **declined**, but
  only if it is **this tab's own** slot (a reload) or the ownerless **legacy** row — unless its tab
  has come back while the prompt was up (below); when its own tab starts a **New Project** —
  `useSessionAutosave`'s `clearSession()` (a no-op under `?suppressRestore=1`, which writes nothing
  to storage) deletes this tab's row and no other, and `useProjectActions` calls it unconditionally;
  or when it is **pruned** at startup for age. **Another tab's slot is never deleted by Start
  Fresh** (ESCSUITE-306): a free tab lock does not prove that tab is gone for good. Chrome's Memory
  Saver (on by default) discards a background tab — its page goes, and its Web Lock with it — but the
  tab stays in the strip with its `sessionStorage`, id and all, and when it is clicked it reloads
  looking for its own slot; a mobile browser killing a background tab does the same. A fresh tab —
  ESCAPECRAFT's "Send to Editor" opens one, with no `?suppressRestore=1` — has no slot of its own, is
  offered the discarded tab's, and Start Fresh used to delete it, so the discarded tab came back
  empty. Now the decline leaves the row, lets go of the offer, and adds the **save** it turned down
  — `{ tabId, timestamp }`, the offered slot's tab id and the `timestamp` every autosave stamps
  afresh — to this tab's **declined list** (`app/declinedSlots.ts`: a JSON array under
  `escapeartist-declined-slots` in `sessionStorage`, one entry per tab, kept beside the tab id so it
  survives this tab's reloads; where `sessionStorage` cannot be written, the entry is kept for the
  document instead; a stored entry of any other shape is dropped on read, nothing migrated).
  `findOfferableSlot(tabId, now, declined)` — `declined` defaulting to that list — skips a slot
  whose **current** `timestamp` is the declined one, without a probe or a claim, after the own-slot
  rule (this tab's own slot is never skipped). A newer save in the same slot — the discarded tab
  came back, edited and was discarded again — is offered again (fix round 1): the user turned down
  the older save, not this one, the principle ESCSUITE-289 applies to an answer.
  Another fresh tab, with a list of its own, may still be offered it: the work is somebody's, and
  that tab is as good a place to recover it. The 30-day prune is what removes a slot whose tab never
  comes back. A failed thumbnail read during a restore leaves the slot in storage, as before. **An offer can go stale** (ESCSUITE-283 fix round 1): the prompt can
  stay up indefinitely, and the departed tab can come back meanwhile and be offered its own slot.
  So `findOfferableSlot` returns, beside the slot, `ownerReturned()` — a fresh `probeTabLock` of
  the slot's tab (always `false` for this tab's own slot and the legacy row) — and both answers ask
  it first: Start Fresh then deletes nothing, and Restore is refused the way a failed thumbnail read
  is ("Failed to restore session", the prompt closed, nothing adopted, the slot left to its tab).
  **And an offer can be overtaken** (ESCSUITE-289): the departed tab can come back, save newer work
  into the same slot and close again — its lock free once more, so `ownerReturned()` says "gone" —
  or come back and start fresh, removing the slot. So both answers then read the slot again
  (`slotAtAnswer(slot)`, `sessionSlots.ts`: the row found by its tab id, a save told apart by its
  `timestamp`, which every autosave stamps afresh), and act on it only when it still holds the
  save that was offered. A **newer save** is never deleted or adopted on the old prompt's say:
  Restore adopts nothing, frees the thumbnails it had read, and re-offers the prompt **in place**
  from the newer save, which stays up under the same offer claim ("That session changed in another
  window — here is the newer one."). The claim is kept rather than let go and claimed again, because
  a release followed at once by an `ifAvailable` request for the same lock can find it not yet let
  go and offer nothing. Re-offering in place is not a fresh `findOfferableSlot` run: a slot another
  tab has left since, newer still, is not considered, and the media check is not repeated — a newer
  save with clips but no source in it is re-offered even though the startup check would not have
  offered it, because it is that tab's real work and the user is asked about it. The owner probe
  runs **before** the re-read, so a tab that comes back between the two is re-offered here while it
  is live, and the next answer's probe then refuses it as ESCSUITE-283 does. `App` keys
  `SessionRestorePrompt` on the offered save's `timestamp`, so the re-offered prompt mounts afresh
  and the click that answered the old one does not leave both its buttons disabled. Start Fresh,
  whose prompt has already closed and whose editor may already be taking a handed-over take,
  deletes nothing: the newer save is left in storage and offered like any other departed tab's
  slot — not necessarily to this tab, whose own slot comes first on a reload ("That session was
  changed in another window, so it was not deleted."). A **removed** slot leaves both answers
  nothing to act on: the prompt closes, the claim is let go, and "That session was removed in
  another window." is said once. All three notices are `info`. A re-read that fails is a failed
  restore on the Restore side — which, like 283's refusal, frees the thumbnails it had read — and
  deletes nothing on the Start Fresh side (logged).
  The offer claim is let go on every answer — after a restore's adoption has deleted the old row,
  after a decline's delete settles (either way, or when it was skipped), and at once when a restore
  fails or is refused — except a restore whose **adoption failed** (`adoptSessionSlot` answers
  `false`, the old row still in storage), which keeps it so no other tab adopts a second copy of
  that row; and by the page itself if the offering tab closes or crashes with the prompt up.
  `findOfferableSlot` returns all three as an `OfferedSlot`, which `offeredSlotRef` keeps. Every tab
  autosaves its own slot — no ownership gate — and a snapshot
  with no sources and no clips (`isEmptySession`, `app/sessionSnapshot.ts`) is still never written.
  Deleting clips alone therefore leaves the last populated snapshot in the slot, and a reload offers
  it back — its sources' bytes are still stored, so that work is still worth offering. A **storage
  clear** that leaves the project with no source and no clip is different (ESCSUITE-307): it has
  just deleted the very bytes that snapshot names, so the media library's three clears (per-item
  Remove, Clear Unused, Clear All) call the autosave's `clearSession()` themselves right after their
  `removeSourceVideosPermanently` write, and the slot goes with the bytes. The explicit call at the
  write site was chosen over the autosave noticing the empty transition, which would have given it
  a second rule about empty snapshots it otherwise never writes. Behind that, a restore reads each
  source's row (`getVideo`) beside its thumbnail and leaves out one whose row is gone — see
  `useSessionRestore.ts` below.

**The limits this leaves.** A tab Chrome's Memory Saver discarded keeps its slot through a Start
Fresh in another tab (ESCSUITE-306, above); a **Restore** in another tab still adopts it — the slot
is rewritten under the restoring tab's id and the old row deleted — so the discarded tab comes back
to an empty editor while the restoring tab holds the work. That is work moved, not lost, and the
deliberate trade ESCSUITE-274 and 283 already made: the restoring tab cannot tell a discarded tab
from a crashed one. A declined save is skipped by this tab only while its slot still holds that
save; a newer save from the same tab is offered here again. A declined slot whose tab never returns
stays in storage, offered to other fresh tabs, until the 30-day prune. A duplicated tab inherits the
declined list it was copied with (a browser copies `sessionStorage` whole), so it too skips the saves
the original declined. Two fresh tabs — tabs with no slot of their own — opened at once after
a crash are no longer both offered the same crashed slot: the first to ask claims that slot's offer
and the second is offered the next slot, or nothing (ESCSUITE-283; ESCSUITE-274 left this open,
and both tabs used to adopt a copy). The legacy shared row has no tab to probe or offer to claim, so
two fresh tabs of a new build can still both be offered it — the one-time upgrade case, two copies of
the work and nothing lost. A slot is offered again only once nobody holds its offer: after a failed
or refused restore, or after the offering tab closed with the prompt up. A departed tab that comes
back while its slot is on offer elsewhere is offered its own slot, as it is on its own; the other
tab's prompt still shows the same work until it is answered, and either answer then leaves the slot
alone while the tab that came back is still open, so that tab is the one that keeps it. The two tabs
can both be offered it in the instant before the returning tab holds its lock again — at worst two
copies, as ESCSUITE-274 had, never a loss. Likewise, an owner that comes back after a restore's
answer-time check has asked and before the adoption has deleted the old row still has that slot
adopted by the other tab: two copies (the returning tab holds the same session in its own prompt),
never a loss. An old prompt answered after its slot's owner came back, saved newer work and closed
again no longer deletes that newer work or adopts the old snapshot over it (ESCSUITE-289, above):
the answer re-reads the slot. What that leaves is the same shape as the owner check's window: a save
that lands between the Restore's re-read and the adoption's delete of the old row — the owner
coming back, saving and closing again within those few milliseconds — is still adopted over, and
one landing between Start Fresh's re-read and its delete of the legacy row (the only row of no
live tab's a decline still deletes) is deleted; and a Start Fresh that finds a
newer save leaves it in storage rather than asking again, because by then the prompt has closed and
the question has settled. The prune does not ask whether a slot's tab is alive, so a tab left open for over 30
days without an edit has its slot pruned by another tab's startup until its next edit writes it
again. During a deploy, a tab still running the old build keeps writing the legacy row, which a
new-build tab offers without a claim. The duplicated-tab rule relies on the
original tab still being alive when the duplicate starts; a duplicate of a tab that has since
closed simply inherits its id and its slot, which is the reload case. A reload relies on the old
document's lock being released before the new document's own-id probe is requested; were a browser
ever to answer that probe `'held'`, the reload would take a new id, and its old slot — a closed
tab's once the old document's lock is gone — would be offered to this tab if that lock is free by
the time it looks at the other slots, and otherwise to the next fresh tab: the same work, under a
prompt, not lost. No other tab's offer is ever held on a tab's own lock (ESCSUITE-283 fix round 1),
so a slot on offer elsewhere is not a reason for that probe to answer `'held'` — though another
tab's answer-time probe of that same lock (`ownerReturned()`) colliding with it, a sub-millisecond
window, would make the reload renew its id while its old slot's offer is held elsewhere, and that
other tab's Restore could then adopt the slot: the one case where the work is moved away from the
tab that wrote it rather than copied (a Start Fresh there no longer deletes it, ESCSUITE-306). `apps/e2e`'s
`escapeartist/session-ownership.spec.ts` drives the crash case with three tabs in one context: A
imports a source and closes, B (open throughout) imports one after it, and a fresh C is offered A's
session — not B's newer one, which only B's live lock keeps off the prompt — and restoring it
leaves exactly B's slot and C's. Its second case opens two fresh tabs together after A closes and
checks that only one of them is offered A's session. Its third (ESCSUITE-306) simulates a Memory
Saver discard — A's page closed, and a new page started with A's `sessionStorage` copied in through
`addInitScript`, which is what a reactivated discarded tab looks like to the app — and checks that
a fresh B's Start Fresh leaves A's slot, B's reload is not offered it again, and A comes back to its
own session (a headed `chrome://discards` "Urgent discard" form is in a comment there, not run in
CI). When the slot a failed restore kept for the next reload is this tab's own (a reload's offer),
importing a file and removing it again within the autosave's 2 s debounce now deletes that kept slot
(ESCSUITE-307: the Remove leaves no source and no clip and calls `clearSession`); before, the
debounced write skipped the empty project and the slot survived. The returning-owner and stale-offer cases are
pinned in the restore hook's ESCSUITE-283 describe, and the overtaken-offer cases (saved again,
removed, a re-read that fails, unchanged) in its ESCSUITE-289 describe and `sessionSlots.test.ts`'s
`slotAtAnswer` cases. The own-slot-first rule is pinned in `sessionSlots.test.ts` and
in the restore hook's "two tabs restored together after a browser crash" case.

**The store selectors stay in `App.tsx` on purpose.** Each hook takes what it needs as plain
parameters rather than subscribing for itself, so the whole subscription set is readable in one
place and every hook is testable without a store. `clips` is the one selector that has to stay
a live array rather than a count: `useAppKeyboardShortcuts`' Ctrl+B (split) branch calls
`clips.find(...)`, while `useProjectActions`' `clipCount` and the header's `canExport` only
ever want `clips.length`.

**The keyboard cascade's 40 deps re-bind the listener, and that is fine — measured, not
assumed.** Every change to one of the 40 values `useAppKeyboardShortcuts` closes over tears the
`keydown` listener off `window` and binds a fresh closure (ESCSUITE-157 added two,
`cropClipId` and `setCropClipId`, to what Round 2 measured at 38). Round 2 counted it rather than
guessing: `useAppKeyboardShortcuts.rebinds.test.tsx` drives the hook through `App`'s own
selectors over a scripted 20-edit burst and measures **15 re-binds** (2026-09-13) — about one
listener swap per edit and none per frame; five edits (a playhead write, a transform, a clip
move, a marker, a blend mode) changed nothing the cascade depends on, because `clips` is a
dependency only through its `length`. **15 is a lower bound, not the app's figure**: the
harness holds `App`'s own seven callbacks at fixed identities, so the count is the store's
contribution alone, and in the live `App` `handleSaveProject` closes over `clipCount` and the
two zoom handlers over the zoom. The extra churn coincides with edits that already re-bind
through `clips.length`, so it does not change the decision. The burst still never opens crop
mode, so `cropClipId`'s addition moves nothing in the measurement — it is a dep the harness
mirrors only so the type checks. Fifteen listener swaps spread over
a minute of editing is
not worth changing the Ctrl+B staleness semantics for, so **the array stays verbatim**. The test
pins that finding, with the assertion to lower if the handler is ever moved into a ref.

**`App` reads `currentTime` on demand and must never subscribe to it.** There is no
`currentTime` selector anywhere in `App.tsx` or `src/app/`: the shortcut handlers that need the
live value (razor split at the playhead, add marker, set in/out point) read
`useEditorStore.getState().currentTime` inside the handler, and `useSessionAutosave` re-arms
its debounce through a `useEditorStore.subscribe` listener added inside its effect rather than
through a render-triggering dependency. See the note in the Preview section above for the whole
story — `App` renders `<Timeline/>`, so a selector here would drag the entire tree through a
re-render every ~200 ms of playback regardless of what `Timeline` itself reads.
`App.rerender.test.tsx` pins exactly this, and nothing else does: a well-meaning change that
turns one of those reads into a selector passes every other App test and fails only that file's
single `toBeLessThanOrEqual(1)`.

Every module below has its own test file. `App.tsx` itself is covered through the six
`App.*.test.tsx` files that drive the rendered editor — `App.test.tsx` (the shell),
`App.project.test.tsx` (new/open/save, the load-safety dialog and the one-dialog rule), `App.session.test.tsx`
(restore prompt and autosave), `App.shortcuts.test.tsx` (the keydown cascade),
`App.messages.test.tsx` (the host integration surface) and `App.rerender.test.tsx` (the
`currentTime` contract above). `src/App.module.css` is deliberately not split: all ten
components import it from `../App.module.css`, and `App.project.test.tsx` imports it directly
and queries `styles.menuBackdrop`.

| Module | Owns |
|--------|------|
| `appConstants.ts` | The shell's plain numbers: the autosave debounce delay, the timeline panel's min/max/default height and the localStorage key it is persisted under. No behaviour, so `timelineHeight.ts`, the hooks and `App` read the same values instead of each spelling them out |
| `timelineHeight.ts` | The timeline panel's height maths: `clampTimelineHeight` (which propagates `NaN` rather than clamping it), the localStorage read/write pair, and `heightFromPointer`, the resize drag's pointer-to-height conversion. Pure but for the two storage calls, so the maths is testable without a DOM |
| `appFormat.ts` | The three notification strings: `formatTimeForNotification` (a one-line pass-through to `formatTime`, kept because three call sites read better for it), `clipCountMessage`, which spells the pluralisation rule once, and `takeLoadedMessage`, the handoff's one sentence, which folds "how many tracks" and "what was missing" into the single toast slot |
| `sessionSnapshot.ts` | `buildSessionSnapshot(state, timestamp, tabId)` — what of the editor's state the autosave writes, and in what shape, stamped with the tab whose slot it is (ESCSUITE-274). Takes the state, the timestamp and the tab id as values rather than reading `getState()`/`Date.now()` itself, so the call site keeps control of *when* they are read. Strips every source video's `thumbnailUrl` before it is written (ESCSUITE-96): the field is only ever an `URL.createObjectURL` handle, and persisting one would just be writing down a URL nothing can ever open again. `isEmptySession(session)` — no sources and no clips, `holdsNoWork` — is what the autosave asks before every write, so an empty project never overwrites the slot (ESCSUITE-227); a storage clear that leaves the project that way empties the slot itself (ESCSUITE-307) |
| `tabId.ts` | This tab's id (ESCSUITE-274): `readTabId()` — the id kept in `sessionStorage` under `escapeartist-tab-id`, or a new one (`crypto.randomUUID()`, or 128 bits of `crypto.getRandomValues` as hex outside a secure context) kept there — and `renewTabId()`, which replaces it for a duplicated tab. A reload keeps the id; a new tab gets a new one; where `sessionStorage` throws, the id lasts for the document. Both take a `TabIdSource`, `{ embedded, tabKey }`, defaulting to a top-level tab (ESCSUITE-332): embedded, neither touches `sessionStorage` — `readTabId` answers `host:<tabKey>` for a frame the host named with `?tabKey=` and an id for this page load otherwise, and `renewTabId` mints in memory, warning once naming the key when a `host:` id was found held (a second frame given the same key). See "One session slot per tab" above |
| `sessionSlots.ts` | Which saved session the prompt offers, and how a restored one changes hands (ESCSUITE-274): `findOfferableSlot(tabId, now, declined?)` prunes slots older than `SESSION_SLOT_MAX_AGE_MS` and returns this tab's own slot whenever it has one (none if that slot holds no source), and otherwise the newest slot with media whose tab is gone and whose current save this tab has not declined (`declined`, default `readDeclinedSlots()`, matched on tab id and `timestamp`, skipped without a probe or a claim, ESCSUITE-306) — the legacy shared row without a probe or a claim, every other probed through `probeTabLock` and then claimed through `claimOfferLock`, whose offer lock it holds while the slot is on offer (ESCSUITE-283) — as an `OfferedSlot`, `{ slot, release, ownerReturned }`; `adoptSessionSlot(slot, tabId)` writes it again under this tab's id, stamped now, then deletes the old row, answering whether it did (a `false` keeps the offer claimed, ESCSUITE-283); `slotAtAnswer(slot)` reads the offered slot again when the prompt is answered and says `'unchanged'`, `'removed'`, or hands back the newer save (ESCSUITE-289). See "One session slot per tab" above |
| `declinedSlots.ts` | The saves of other tabs' slots this tab has declined (ESCSUITE-306): `rememberDeclinedSlot({ tabId, timestamp })` writes a JSON array of `DeclinedSave` entries — one per tab, a later decline replacing the earlier — to `sessionStorage` under `escapeartist-declined-slots` (`DECLINED_SLOTS_KEY`), and `readDeclinedSlots()` reads it back, after the entries this document kept because `sessionStorage` would not take them; a stored value that is not JSON or not a list reads as none, and an entry that is not `{ tabId: string, timestamp: number }` is dropped. `__resetDeclinedSlotsForTests()` clears the same-document list between cases. Survives this tab's reloads, and a duplicated tab inherits it; no other tab sees it — except the other ESCAPEARTIST frames of one host page, which share the top-level tab's `sessionStorage` and so this list (ESCSUITE-332; a decline in one frame hides that save from the others). Start Fresh on another tab's slot writes it instead of deleting the slot (its tab may only be discarded, Chrome's Memory Saver), and `findOfferableSlot` skips a slot whose current `timestamp` is the declined one. See "One session slot per tab" above |
| `sessionLock.ts` | Which tabs are alive (ESCSUITE-274, after ESCSUITE-227): `holdTabLock(tabId, locks?)` holds the Web Lock `escapeartist-tab:<tabId>` for the tab's lifetime and `probeTabLock(tabId, locks?)` asks after one without taking it, and `claimOfferLock(tabId, locks?)` takes the separate offer lock `escapeartist-offer:<tabId>` (`offerLockName`) with `ifAvailable` and keeps it until its release runs, never touching the tab lock itself (ESCSUITE-283; `NO_HOLD` is the release that lets go of nothing), each taking the `LockManager` as an argument (default `navigator.locks`) so the tests hand in `src/test/doubles/locks.ts`; all three answer as a lone tab where Web Locks are missing or reject. See "One session slot per tab" above |
| `useThemeLifecycle.ts` | Starting the shared theme module on mount and stopping it on unmount. The editor's **first** effect, so `App` calls it first |
| `useNotification.ts` | The transient status toast: one slot, not a queue. `showNotification` overwrites whatever is showing and opens a fresh three-second timer, which is deliberately neither stored nor cleared — carried behaviour, pinned by the App suite. Binds no effect; sits second because every hook after it takes `showNotification` |
| `useProjectActions.ts` | Project lifecycle: save to disk, open from disk with the "you have unsaved work" dialog in front of it, and start over. Owns `isSaving`, `isLoading`, `showProjectLoadDialog` and the pending file — and the editor's **only** project-load dialog: `handleProjectFile(file)` is the "given a project file" entry the uploader's drop/pick path calls, with `handleLoadProject` being that same entry behind the file picker (see "Dialogs"). Takes `clipCount` as a number, the dependency both callbacks carried inline. Binds no effect; sits fifth — right after `useSessionAutosave`, whose `clearSession` it takes (ESCSUITE-227 fix round 1, ESCSUITE-274; it sat third before), and before the shortcut hook, which takes `handleSaveProject` and `handleLoadProject`. `handleNewProject` calls `clearSession()`, which empties **this tab's own** slot and no other (ESCSUITE-274) — every tab has its own, so a New Project never touches another tab's crash recovery — and does nothing under `?suppressRestore=1`. `loadProjectFile` (shared by every path above) runs `parseProject` on what `loadProject(file)` read back **before** calling `resetProject()` (ESCSUITE-102): a malformed file used to throw out of `setProject`'s migration *after* the reset had already emptied the editor, leaving the failure notice over a blank timeline; now a bad file shows "Failed to load project: \<reason\>" and the current project is never touched. A `.veditor` that `loadProject` itself refuses (a damaged or cut-off v2 file, one that will not fit in storage, or, on either version, a project `parseProject` refuses, checked there before any source is stored, ESCSUITE-260) throws `ProjectFileError` and gets the same "Failed to load project: \<reason\>" sentence; any other throw keeps the bare "Failed to load project". On save, a `ProjectFileError` (the writer's index cap) is shown as its own message and anything else as "Failed to save project"; a failed save-and-load keeps its dialog either way. `loadProject(file)` has already minted a `thumbnailUrl` for every incoming source by the time it returns, so a REFUSED load (a `parsed.ok === false`, or anything that throws before the sources are actually handed to `addSourceVideo`) revokes those incoming thumbnails itself — nothing is ever going to render them. A load that *succeeds* does **not** also revoke the outgoing library here: that is `resetProject()`'s own job (ESCSUITE-113, `store/projectSlice.ts`), and revoking it twice from two places was the review round's own finding. `clearHistory()` runs once every source has landed, right before the success notification (ESCSUITE-164) — left out, `resetProject()` + `setProject()` + one `addSourceVideo` per source were four separate undo entries, and the first Ctrl+Z after an open landed on "loaded project, one source missing" rather than whatever was open before. Opening a file is a new document, not an edit, so it is not undoable at all — parity with `useSessionRestore`'s own `clearHistory()` and `handleNewProject`'s. It is **not** called on any failure path: a load that throws partway through (ESCSUITE-113's own case — `addSourceVideo` dies on the second of three sources) leaves whatever undo history the editor held before the user picked this file untouched, because there is nothing to clear history *to* |
| `useSessionRestore.ts` | The "Resume Previous Session?" lookup on startup and the two answers to it, and the `sessionRestored` flag the autosave gates on. The editor's **second** effect. `handleRestoreSession` rebuilds every source's `thumbnailUrl` before writing the store — the snapshot no longer carries one — resolving each with `Promise.all` (the reads are independent) so the library renders once with live pictures rather than once broken and once fixed (ESCSUITE-96). It does **not** revoke anything itself: the library is not reliably empty when a restore lands — the CRAFT handoff (`useHostIntegration` → `importTake`) adds a take's parts to it as soon as they arrive, well before the placement that waits on `sessionDecisionPending` — so a blanket revoke of "whatever is here" would kill the handoff's still-live thumbnails. `addSourceVideo` (`store/projectSlice.ts`) is the one place that owns freeing a replaced source's *old* thumbnailUrl, exactly when a restored source happens to share an id the handoff already added (ESCSUITE-113). Restoring is therefore asynchronous, not the single-tick write it used to be, and is guarded against both ways that window can be walked into: a `restoreAttemptRef` set at entry makes a second `handleRestoreSession` call while one is already reading thumbnails a no-op, and `handleDeclineSession` clears it, so "Start Fresh" clicked mid-restore wins — the restore finds its answer overruled when its reads come back and does not commit. `SessionRestorePrompt` disables both buttons the moment either is clicked, as the first line of defence against the same race. A rejected thumbnail read is answered the same way a decline is — the ref is cleared, the prompt closes, `sessionRestored` settles, and the user is left with a fresh project — except the notification says the restore failed and the saved session is left in storage rather than cleared, so a reload can still offer it. Since ESCSUITE-307 each source's row is read with `getVideo` beside its thumbnail, in the same `Promise.all`: a source whose row is gone — its bytes deleted after the session was saved — is left out with every clip that plays it (`timelineWithoutSources`, `store/projectFactory.ts`, the arithmetic `removeSourceVideosPermanently` uses, duration recalculated), the thumbnail minted for it is revoked at once, a selection naming one of its clips is dropped, the editor block is clamped to the **migrated** timeline that was restored (`repairEditorBlockForProject`, ESCSUITE-329 — the raw session clips used to be the reference, which the ESCSUITE-304 repair can lengthen), and one `info` notice — `N file(s) in the saved session are no longer in storage and were left out` (`sessionSourcesLeftOutMessage`, `app/appFormat.ts`) — takes the place of "Session restored", even when everything was left out and the restore is an empty project. With nothing left out the saved project is handed to `setProject` as it is. Since ESCSUITE-274 it owns this tab's id (`readTabId`, returned as `tabId`): the startup check first probes this tab's own lock and renews the id of a duplicated tab, then offers what `findOfferableSlot` returns — this tab's own slot first, otherwise the newest slot with media whose tab is gone — keeping the offered slot in `offeredSlotRef` so Start Fresh deletes that slot only when it is this tab's own or the legacy row — another tab's is left in storage and its save remembered through `rememberDeclinedSlot({ tabId, timestamp })` so this tab does not offer that save again (a newer one it does), because a free tab lock may be a tab Chrome's Memory Saver discarded, which comes back for its slot (ESCSUITE-306) — and a restore adopts it (`adoptSessionSlot`) unless it is this tab's own, with the release of the offer claimed for it, which a decline runs once its delete settles, a restore once the adoption has deleted the old row (not when the adoption failed), and a failed or refused restore at once; both answers first ask the offered slot's `ownerReturned()`, and a stale offer's decline deletes nothing while its restore is refused like a failed one (ESCSUITE-283); and both then re-read the slot (`slotAtAnswer`): a newer save is re-offered in place by a restore and left in storage by a decline, a removed slot closes the prompt, each with one `info` notice (`SESSION_NEWER_NOTICE`, `SESSION_KEPT_NOTICE`, `SESSION_REMOVED_NOTICE`), and only an unchanged slot is deleted or adopted (ESCSUITE-289); the check starts once per mount (`checkStartedRef`) so StrictMode's second run cannot probe against the first. `SESSION_HELD_NOTICE` (ESCSUITE-227) is gone |
| `useSessionAutosave.ts` | The debounced session write. The editor's **third** effect, registered immediately after `useSessionRestore` for the reason above; re-arms on `currentTime` through a subscription inside the effect, never a selector. A rejected write used to go to `console.error` alone (ESCSUITE-217): now it also raises the editor's one notice, through `showNotification` — the media library's own quota sentence (`components/VideoUploader.tsx`'s "Storage quota exceeded. Remove some media to free up space.") when the browser's error name is `QuotaExceededError`, read through `error.cause ?? error` the same way ESCSUITE-210 reads it in ESCAPECRAFT, or a generic "Your session could not be saved — storage may be full." for anything else. The sentence choice is the pure, exported `autosaveFailureNotice(error)`. A ref-backed latch — not state, since it must survive the effect re-running on every edit without itself causing a render — reports once per run of failing ticks and clears on the next SUCCESSFUL write, so a later failure (a new run) is reported again; `console.error` still logs every failure's detail regardless of the latch. Its second effect (the editor's **fourth**, ESCSUITE-227; since ESCSUITE-274 `holdTabLock(tabId)`) holds this tab's lock and releases it on unmount, or when a duplicated tab is given a new id; the timer writes this tab's own slot, `session:<tabId>`, with no ownership gate, and never an `isEmptySession` snapshot. Neither costs a render. It returns `clearSession()`, New Project's and — since ESCSUITE-307 — the media library's three storage clears', when one leaves the project with no source and no clip: this tab's row only, a no-op under `?suppressRestore=1`. `?suppressRestore=1` holds no lock |
| `useTimelineZoom.ts` | The two zoom steps, one factor of 1.25 each way. Binds no effect; sits sixth because the shortcut hook and the timeline footer call the same two handlers |
| `useAppKeyboardShortcuts.ts` | The global `keydown` listener: one ordered cascade of `if`s where the order *is* the semantics — `c`/`v`/`o` sit below their Ctrl chords so each bare letter only sees what fell through, and the Escape cascade runs shortcuts sheet → crop mode → in/out points → multi-selection → single selection (the crop-mode branch, ESCSUITE-157, sits there so deselecting never leaves crop mode as a side effect and takes the selection with it). Above all of it sits `modalOpen`, which stops the cascade dead while a dialog is up (see "Dialogs"). The editor's **fifth** effect. Its deps array is the inline one character for character plus `modalOpen`, `clips.length` included while the Ctrl+B branch reads `clips.find` — a known staleness, carried deliberately. **40 deps, measured and left verbatim** — see below. Its five editing branches — Delete/Backspace on a multi-selection, Delete/Backspace on a single clip, Ctrl+V, Ctrl+D and Ctrl+B — ask `store/trackLock.ts` about the lock on demand before calling the store and toast "Track is locked" instead when it would refuse (ESCSUITE-84) |
| `useTimelineHeight.ts` | The resize drag, the double-click reset and the persisted height. The editor's **sixth** effect; its `[isResizing, timelineHeight]` deps re-bind both document listeners on every clamped pixel of a drag, which is load-bearing — it is how `handleResizeEnd` closes over the final height. `src/hooks/useDocumentListener.ts` keeps its handler in a ref and would break exactly that, so it is not used here |
| `useHostIntegration.ts` | The inbound `postMessage` handler and the startup work the URL parameters ask for. The editor's **seventh and last** effect. Its deps are `[]` even though it closes over four values: the handler is installed once, `GET_STATE` works around the staleness with an explicit `getState()`, and the rest rely on those four being stable for the component's life. Keeps no thumbnail owner: the take's parts and their thumbnails are the library's from the moment `importTake` hands them over, so neither the cleanup, nor the cancelled-import path, nor a take dropped at placement time revokes them (ESCSUITE-117) |
| `takeImport.ts` | The storage half of the `?loadVideo=` handoff: resolve the take's parts, read each one's blob and thumbnail, add it to the library with a resolved duration, and return the parts to place (`ImportedTake`: `clipParts`, `missingParts`). Every thumbnail URL it mints goes to `addSourceVideo` with its part and is the store's to free from there (ESCSUITE-117) — it keeps its own list only long enough to revoke it if the import throws part-way, and does not report it, since ESCSUITE-140 nothing outside its own tests read that report. Lives beside the hook rather than inside it because the hook's effect is already the app's longest and these are the arms worth testing on their own |
| `AppHeader.tsx` | The top bar: the dashboard link (hidden in the standalone build, which this component asks about itself), the wordmark, the project-name field, and the File menu plus the quick Save and Export buttons |
| `FileMenu.tsx` | The header's File dropdown: the button, the click-outside backdrop, and the four items with their shortcut hints. Each item acts and then closes; what "acts" means belongs to the caller |
| `MediaLibrarySidebar.tsx` | The left sidebar: its header and collapse button, and — while open — the uploader, the resolution picker and the library listing. Four of its props are pure pass-throughs it has no behaviour of its own for — `onConfirmOpenChange` to `ResolutionPicker`, `onProjectFile` to `VideoUploader`, `showNotification` to `VideoUploader` (ESCSUITE-142: how Clear All reports a partial failure), and `clearSession` to `VideoUploader` and `VideoLibrary` (ESCSUITE-307: the autosave's, which a storage clear that leaves no source and no clip calls) — and all four are **required** here, so a caller that forgets to wire any of them fails to compile (see "Dialogs" for the first two) |
| `InspectorSidebar.tsx` | The right sidebar: the inspector's header and collapse button, with `ClipEditor` underneath while it is open |
| `MobileInspectorToggle.tsx` | The floating inspector toggle shown at narrow widths, rendered inside `<main>` as a sibling of the inspector it controls |
| `TimelineResizeHandle.tsx` | The grab strip between the editor body and the timeline. It reports the two gestures and nothing else; the drag belongs to `useTimelineHeight` |
| `TimelinePane.tsx` | The bottom pane: add-track, zoom out, the zoom readout and zoom in, above `Timeline` itself. **Deliberately not memoised** — `App.rerender.test.tsx` counts `Timeline` renders, and a memo here would make that pass for the wrong reason and hide a future `currentTime` subscription |
| `NotificationToast.tsx` | The status toast in the corner. The `{notification && …}` guard stays in `App`, so it never renders an empty live region |
| `LoadingOverlay.tsx` | The modal spinner shown while a project loads. The `{isLoading && …}` guard likewise stays in `App` |
| `SessionRestorePrompt.tsx` | The "Resume Previous Session?" modal and its two buttons. The `{showSessionPrompt && pendingSession && …}` guard stays in `App`, so `session` is always present here — and so "closed" is "unmounted", which is why its `useDialogBehaviour` keeps the default `isOpen`. **Escape is swallowed** by a no-op: declining deletes this tab's own or the legacy session, and leaves another tab's (ESCSUITE-306), so a dismissal key must not reach it. See "Dialogs". Both buttons disable themselves the moment either is clicked (ESCSUITE-96) — restoring reads thumbnails before it answers, and a click on the other button (or a second click on the same one) in that window must not reach `useSessionRestore` a second time |
