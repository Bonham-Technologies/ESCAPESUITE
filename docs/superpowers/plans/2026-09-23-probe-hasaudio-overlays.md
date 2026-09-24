# Small follow-ups II: hasAudio from the real streams, the probe's two answers, ARTIST overlays trapped

**Goal:** close ESCSUITE-62 and ESCSUITE-61 in ESCAPECRAFT (one branch) and give ESCAPEARTIST's
three untrapped overlays the shared dialog behaviour (another branch).

**Spec:** Jira ESCSUITE-62, ESCSUITE-61; the F4 finding recorded in the modal-gate review
(`apps/artist/CLAUDE.md` keyboard section names it). This plan is the working authority.

## Global constraints

1. Branch `fix/craft-probe-and-hasaudio` (Tasks 1 + 2, one changeset `@escapesuite/craft: patch`
   naming both) and branch `fix/artist-overlays-dialog-hook` (Task 3, changeset
   `@escapesuite/artist: patch`). One PR each.
2. Coverage floors only go up: craft 100/99/96/99, artist 99/98/93/98. Every new line and branch
   executes in a test; read the `test:coverage` summary.
3. Red-then-fix; record the failure. Existing pinned tests may change only where the behaviour
   they pinned is the behaviour being changed, and the report says which and why.
4. Docs in the same PR (`apps/craft/CLAUDE.md` "Download Formats" probe paragraph; `apps/artist/
   CLAUDE.md` keyboard/dialog section, where F4 is recorded as open — it becomes closed). Lint +
   typecheck clean (craft; artist + e2e). Commit trailers as given in the dispatch. No push, no PR.

## Task 1 — ESCSUITE-62: `hasAudio` from what was actually captured

`useRecordingSave` persists `hasAudio = config.microphoneEnabled || config.systemAudioEnabled`,
and `buildRecordingEntry` uses the same expression. Wrong in one reachable case: System Audio
ticked in CRAFT but cleared in Chrome's share picker — the controller already knows
(`systemAudioShared` in the store, computed from the display stream's tracks at take start,
reset to `true` when the next take starts, so at save time it still describes the take just
finished).

- `hasAudio = config.microphoneEnabled || (config.systemAudioEnabled && systemAudioShared)`, in
  BOTH records: `buildSourceVideo` (already takes `hasAudio`) and `buildRecordingEntry` (gains a
  `systemAudioShared: boolean` input, or a precomputed `hasAudio` — one expression, computed
  once in `useRecordingSave`, handed to both). `useRecordingSave` reads
  `useRecorderStore.getState().systemAudioShared` at save time (a store read, not a subscription
  — the hook must not add a render).
- Tests, red first: `useRecordingSave.test.ts` — mic off, system audio enabled, `systemAudioShared`
  false → both records `hasAudio: false`; shared true → true; mic on → true regardless.
  `recordingMetadata.test.ts` for the builder change.

## Task 2 — ESCSUITE-61: the probe answers for H.264 and AAC independently

`probeMP4Support()` sets `audio: false` as soon as the H.264 check fails, and `reason` is the
H.264 sentence; the M4A button (which needs only AAC) then shows the H.264 reason.

- `MP4SupportProbe` / `Mp4Support` gain `audioReason?: string` — the sentence for a missing AAC
  encoder (`MP4_NO_AUDIO_REASON`, or `MP4_NO_WEBCODECS_REASON` / `MP4_PROBE_FAILED_REASON` when
  the whole probe could not run). `audio` is the AAC answer regardless of the H.264 answer;
  `supported` and `reason` stay the MP4 (H.264) verdict. The two `isConfigSupported` calls are
  already made; only the folding changes.
- `useMp4Download`: the M4A gate uses `audioReason ?? MP4_UNSUPPORTED_REASON`; the MP4 silent-
  file note (supported, no AAC) also reads `audioReason`. MP4 gating unchanged.
- Tests, red first: `converter.test.ts` — H.264 refused + AAC accepted → `{ supported: false,
  audio: true, reason: MP4_NO_H264_REASON, audioReason: undefined }`; both refused → `audio:
  false, audioReason: MP4_NO_AUDIO_REASON`; WebCodecs absent → both reasons the WebCodecs
  sentence. The pinned "asks about the same H.264 and AAC configuration" test stays green (the
  configs did not change) — if its assertions on the folded result must change, say exactly which
  line and why. `useMp4Download.test.ts` — with H.264 missing and AAC present the M4A button is
  NOT blocked and MP4 is; with AAC missing the M4A reason is the AAC sentence.
- Docs: the probe paragraph in `apps/craft/CLAUDE.md` "Download Formats" (two answers, two
  sentences).

## Task 3 — ARTIST: the three untrapped overlays adopt `useDialogBehaviour`

`SessionRestorePrompt` (`app/SessionRestorePrompt.tsx`, `role="dialog" aria-modal` but no trap),
the project-load dialog (find it: `grep -rn "showProjectLoadDialog" apps/artist/src`), and
`KeyboardShortcuts` (`components/KeyboardShortcuts/KeyboardShortcuts.tsx`, no role, its own
`window` Escape/`?` listener since #421) are modal in appearance but trap no focus: Tab walks
out to the editor behind them.

- Each adopts `useDialogBehaviour(onClose, isOpen)` from `@escapesuite/shared/hooks` the way
  `ExportDialog` does (`ref` on the panel, `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby` its heading, `tabIndex={-1}` on the container if the hook's Shift+Tab rule
  needs it — read the hook's doc comment). Initial focus, Tab/Shift+Tab trap, Escape-to-close
  with propagation stopped, focus restored to the opener.
- **Escape's meaning per overlay is a decision, not a default:** for the Keyboard Shortcuts
  sheet Escape closes (already true; its own listener then keeps only the `?` toggle — remove the
  Escape half so there is one Escape path, and keep the typing guard); for the project-load
  dialog Escape cancels; for `SessionRestorePrompt` read what `onDecline` does — if declining
  discards the saved session, Escape must NOT do that: pass a no-op close so Escape is swallowed
  (focus stays trapped, nothing destroyed) and say so in a comment and the doc; if declining only
  hides the prompt and leaves storage alone, Escape may decline.
- Tests, red first (jsdom, the shared hook's own suite covers the mechanics — these pin the
  wiring): each overlay has `role="dialog"` with an accessible name; opening moves focus inside;
  Tab from the last focusable wraps to the first; Escape does what was decided (and, for the
  prompt, does not call `onDecline` if that was the ruling); focus returns to the opener on
  close. One axe e2e per overlay in `apps/e2e/tests/accessibility/core.spec.ts`'s ESCAPEARTIST
  describe, RED first where the missing role makes `getByRole('dialog', { name })` fail today
  (the sheet at least), shaped like the CRAFT dialog audits in the same file.
- `App.rerender.test.tsx` must not change. Docs: the keyboard/dialog section of
  `apps/artist/CLAUDE.md` — F4 closed, the three Escape meanings stated.

## Verification

Per package: `test:coverage` (floors), `lint`, `typecheck`; Task 3's axe e2e against dev servers
started from its worktree (check `lsof -nP -iTCP:5174 -iTCP:5175 -sTCP:LISTEN` and `uptime` first).
