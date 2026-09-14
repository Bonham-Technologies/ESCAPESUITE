# Keyboard access for the ESCAPEARTIST keyframe graph — ESCSUITE-48 (Implementation Plan)

Bug filed for the Delete double-fire found here: ESCSUITE-49 (fixed by Task 1, red-first).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one PR on branch `feat/keyframe-graph-keyboard` making every operation the mouse can
perform on `KeyframeGraph` reachable from the keyboard, with WAI-ARIA listbox semantics, an
accessible name per keyframe handle, a live region for nudges, and a hard contract that the
graph's keys never reach the editor's two `window`-level keydown handlers. Four tasks, five
commits (Task 1 is RED-then-fix), one PR. Ships as a patch changeset for `@escapesuite/artist`.

---

## Current structure (verified on main @ `2e4f502`)

**The graph is one `<svg>` with zero keyboard affordances.**
`apps/artist/src/components/KeyframePanel/KeyframeGraph.tsx:376-503` renders
`div.graphWrap` → `<svg className={styles.graph} viewBox="0 0 500 200" preserveAspectRatio="xMidYMid meet">`
with no `tabIndex`, no `role`, and no `onKeyDown`. Inside it: a decorative grid `<g>` (`:387-421`),
the curve `<path>` (`:424`), the playhead `<line>` (`:427-435`), one `<circle>` per keyframe
(`:438-466`) and a help `<text>` reading *"Double-click to add • Right-click to delete • Drag to
move"* (`:469-476`) — every one of those verbs is a pointer. The only non-pointer input in the file
is a `window` keydown listener for Delete/Backspace (`:233-244`).

**Every keyframe operation, and how it is reached today:**

| Operation | Today | Handler |
|---|---|---|
| select a keyframe | click a `<circle>` | `handleKeyframeClick` `:216-221` (custom keyframes only) |
| move time **and** value | drag | `handleKeyframeMouseDown` `:198-213` → `onKeyframeMoved` + `onKeyframeValueChanged` `:314-326` |
| move time only | Alt-drag | `dragType: 'time'` `:211` |
| change value only | Shift-drag | `dragType: 'value'` `:211` |
| delete | right-click, **or** Delete/Backspace after a click | `handleKeyframeContextMenu` `:224-230`, `window` listener `:233-244` |
| add | double-click at (x,y) | `handleDoubleClick` `:348-362` → `onAddKeyframe` |
| deselect | click the background | `handleGraphClick` `:343-345` |
| change easing | the `<select aria-label="Keyframe easing">` | `:479-501`, already Tab-reachable (`KeyframeGraph.test.tsx:348-359` proves it) |

**The one existing keyboard path is broken, and this is a real user-visible bug.**
`KeyframeGraph.tsx:242` registers its Delete/Backspace handler on `window`;
`app/useAppKeyboardShortcuts.ts:354` registers the editor's cascade on `window` too, and its Delete
branch (`:146-163`) fires whenever `selectedClipId` is set. The keyframe panel only renders a graph
when a clip **is** selected (`KeyframePanel.tsx:207,232,246`), and `App` mounts before the panel, so
its listener runs first: **pressing Delete with a keyframe selected deletes the whole clip**, then
the graph asks to delete a keyframe on a clip that no longer exists. Neither handler stops the
other — `useAppKeyboardShortcuts.ts:121` only skips `HTMLInputElement`/`HTMLTextAreaElement`.

**Three `window`/`document` keydown listeners exist in artist** and all three must be reasoned
about: `app/useAppKeyboardShortcuts.ts:354` (the cascade), `components/Preview/PlaybackControls.tsx:75`
(Space / ArrowLeft / ArrowRight / Home / End, switched on `e.code`, `:51-71`) and
`components/Export/ExportDialog.tsx:266` (`document`, **capture** phase — only while the dialog is
open, and it is modal, so it is out of scope here). Both window listeners skip only
`HTMLInputElement`/`HTMLTextAreaElement` (`useAppKeyboardShortcuts.ts:121`,
`PlaybackControls.tsx:47`) — **a `<select>` is not skipped**, which is why the easing select must
never be the thing that owns graph keys.

**React's `stopPropagation` is sufficient to shield them.** React 17+ attaches its listener at the
root container, which sits *below* `window`; `SyntheticEvent.stopPropagation()` calls
`nativeEvent.stopPropagation()`, so a React `onKeyDown` on the `<svg>` that stops propagation
prevents both window listeners from ever seeing the event. This is the mechanism the whole design
rests on and Task 3 pins it with a spy.

**jsdom can focus an SVG element — verified, not assumed.** `jsdom@30.0.1` (artist's resolved
version): `svg.setAttribute('tabindex','0'); svg.focus()` sets `document.activeElement` to the
`<svg>`. So `userEvent.tab()` / `.focus()` / `user.keyboard` all work against the plan's design in
the existing jsdom test environment.

**Store surface — no new actions needed.** `store/projectStore.ts:662` `setClipKeyframe(clipId,
property, keyframe)` (replaces the keyframe within 0.001 s, else inserts and sorts; auto-creates a
keyframe at t=0), `:741` `removeClipKeyframe(clipId, property, time)`, `:777`
`moveClipKeyframe(clipId, property, originalTime, newTime)` — which **silently drops any keyframe
already within 0.001 s of `newTime`** (`:790`). All three push history. `KeyframePanel.tsx` already
wires them: `handleKeyframeMoved:120`, `handleAddKeyframe:131`, `handleKeyframeValueChanged:158`,
`handleKeyframeEasingChanged:180`, `handleDeleteKeyframe:201`.

**Keyframes come from `utils/animation.ts:510` `getAllKeyframesForProperty`**, which merges
*preset* keyframes (generated from `animation.in`/`animation.out`) with the user's *custom* ones,
sorted by time. `KeyframeGraph.tsx:84-87` `isCustomKeyframe` is the only thing that tells them
apart; presets are not selectable, not draggable, not deletable (`:199`, `:218`, `:227`) and the
easing select never appears for one (`:372-374`, pinned by `KeyframeGraph.test.tsx:267,379`).

**Value ranges and the units they are in** — `KeyframeGraph.tsx:24-33` `PROPERTY_RANGES`:
`x`,`y` 0–1 (fraction of canvas), `scaleX`,`scaleY` 0–3 (factor), `rotation` −360–360 (degrees),
`opacity` 0–1, `blur` 0–50 (px), `volume` 0–1. `formatValue` (`:189-195`) renders them as `%`, `°`,
`px` or two decimals. Drag clamps value to `[range.min, range.max]` and time to `[0, clipDuration]`
(`:293-294`) — keyboard nudges must clamp identically.

**Accessibility conventions already in artist** (grep of `role=` / `aria-` / `tabIndex` /
`onKeyDown` across `src/components` and `src/app`): `Timeline/TimelineRuler.tsx:52-54`
(`tabIndex={0} role="group" aria-label="Timeline ruler"` — the in-repo precedent for making a
non-form region focusable), `app/NotificationToast.tsx:15` (`role="status" aria-live="polite"` —
the precedent for a live region), `app/FileMenu.tsx:68` (`role="menu" aria-label`),
`Export/ExportDialog.tsx:281` + `app/LoadingOverlay.tsx:11` + `app/SessionRestorePrompt.tsx:22`
(`role="dialog" aria-modal aria-labelledby`), `Timeline/TrackHeader.tsx:142` and
`Preview/InlineTextEditor.tsx:102` (element-scoped `onKeyDown`, the pattern to copy). There is **no**
`aria-activedescendant`, no `role="listbox"`, and **no sr-only/visually-hidden class anywhere in
artist** — one must be added to `KeyframeGraph.module.css`.

**What CI enforces for a11y.** `apps/e2e/utils/accessibility.ts` wraps `@axe-core/playwright`
(`runAxeCheck`, `assertNoA11yViolations`, `checkKeyboardNavigation`, `checkFocusVisibility`,
`checkFormLabels`). `apps/e2e/tests/accessibility/core.spec.ts:122-186` is the ESCAPEARTIST
describe: it loads `localhost:5175` bare and fails on serious/critical violations with
`color-contrast` disabled. **It never opens the keyframe panel**, so nothing in CI sees this graph
today. `@axe-core/playwright` is an `apps/e2e` dependency only — there is **no** jsdom axe
(`jest-axe`/`vitest-axe`) in `apps/artist`, so unit-level a11y assertions are role/name queries,
and axe stays in e2e.

**The in-app shortcut sheet** is `src/components/KeyboardShortcuts/KeyboardShortcuts.tsx:13-75`, a
`shortcutGroups` array of six groups (Tools, Playback, Editing, Timeline, Panels, File). It has its
own `KeyboardShortcuts.test.tsx`. Opened with `?` (`useAppKeyboardShortcuts.ts:323`).

**Coverage floors.** `apps/artist/vite.config.ts:166-171` — lines 99 / statements 98 / branches 93 /
functions 98. Root `CLAUDE.md` records artist at 99.33 / 98.58 / **93.02** / 98.86 — roughly **one
branch of headroom**. Floors are mirrored in three places: that config, `scripts/coverage-report.mjs`
and the root `CLAUDE.md` table.

## Existing tests that constrain this work

| File | What matters here |
|---|---|
| `KeyframeGraph.test.tsx:1-84` | The harness: `renderGraph(property, opts)`, `measureGraph` (stubs `getBoundingClientRect` to 500×200 so screen px == viewBox px), `points(container)` = all `<circle>`s, `xForTime`/`yForUnitValue`, `opacityKeyframes()` (a custom keyframe at 1 s, so the store auto-creates one at 0 s → **two** points, index 1 is the custom one) |
| `KeyframeGraph.test.tsx:218-237` | `deletes the selected keyframe on Delete` / `on Backspace` — both drive `fireEvent.keyDown(window, …)`. **These two must change** when the listener moves off `window` (Task 1) |
| `KeyframeGraph.test.tsx:239-246` | `ignores other keys while a keyframe is selected` — must stay green |
| `KeyframeGraph.test.tsx:267-288` | `will not select or delete a preset keyframe` (asserts no `styles.selected` and no delete) and `survives a right-click when the host offers no delete handler` — both also fire on `window`; both must keep their meaning |
| `KeyframeGraph.test.tsx:348-359` | `is reachable from the keyboard and commits without a pointer` — `user.tab()` from a selected keyframe lands on the easing select. **After Task 1 the `<svg>` is a tab stop before it**, so this test's tab count changes by one |
| `KeyframeGraph.test.tsx:399-408` | `leaves the graph itself addressable as the svg` — `.${styles.graph}` must stay the `<svg>` |
| `KeyframeGraph.test.tsx:449-568` | The whole drag suite — untouched by this work; every drag test must stay byte-identical |
| `KeyframePanel.test.tsx:251-352` | `editing keyframes in the graph` — the store-level integration point for a new keyboard test; `:305` `makes the easing change a single undo step` is the precedent for asserting history depth |
| `apps/e2e/tests/accessibility/core.spec.ts:122-186` | The ESCAPEARTIST axe describe to extend; `apps/e2e/utils/artist.ts:22` `seedTextClip(page)` is how a clip gets onto the timeline |

---

## Global constraints

- **Red-then-fix.** Task 1's first commit contains only tests and must fail, pinning the
  Delete-deletes-the-clip bug before anything is changed.
- **No new store actions.** Everything routes through the five callbacks `KeyframePanel` already
  passes (`onKeyframeMoved`, `onKeyframeValueChanged`, `onAddKeyframe`, `onDeleteKeyframe`,
  `onKeyframeEasingChanged`). `store/projectStore.ts` is not edited.
- **The mouse behaviour does not change.** Every test in `KeyframeGraph.test.tsx`'s `drawing`,
  `adding keyframes` and `dragging keyframes` describes stays byte-identical. The only permitted
  edits to that file are the four cases that drive `fireEvent.keyDown(window, …)` (`:218`, `:230`,
  `:267`, `:281`) and the tab count in `:348`.
- **Floors only go up**, in all three places at once (`apps/artist/vite.config.ts`,
  `scripts/coverage-report.mjs`, the root `CLAUDE.md` table). Artist branches has ~1 branch of
  headroom at 93.02%, so **every new branch must be covered by a test** — write the test with the
  branch, not after.
- **ES2020 lib**: no `Array.prototype.at()`, no `??=`. Use `arr[arr.length - 1]`.
- **Never name a new file `types.ts`** — `**/types.ts` is coverage-excluded in artist.
- `pnpm --filter @escapesuite/artist lint` at **0 warnings**, `tsc -b --noEmit` clean,
  `pnpm --filter @escapesuite/artist test:coverage` green, after every task.
- Every commit carries both trailers:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU`.

## The key map this plan implements

Active only while the graph's `<svg>` itself has focus. The easing `<select>` is a **sibling** of
the `<svg>`, not a child, so none of this touches the select's own keyboard behaviour.

| Keys | Action | Step / unit |
|---|---|---|
| `Tab` | into the graph, then on to the easing select (when one is shown) | — |
| `ArrowLeft` / `ArrowRight` | previous / next keyframe in time; selection follows the active option; clamps at the ends (no wrap) | — |
| `Home` / `End` | first / last keyframe | — |
| `ArrowUp` / `ArrowDown` | nudge the selected keyframe's **value** | fine step (table below) |
| `Shift+ArrowUp` / `Shift+ArrowDown` | nudge value, coarse | coarse step |
| `Alt+ArrowLeft` / `Alt+ArrowRight` | nudge the selected keyframe's **time** | −/+ 0.01 s |
| `Alt+Shift+ArrowLeft` / `Alt+Shift+ArrowRight` | nudge time, coarse | −/+ 0.1 s |
| `Enter` | add a keyframe at the playhead, at the curve's value there | — |
| `Delete` / `Backspace` | delete the selected keyframe (custom only) | — |
| `Escape` | clear the graph's selection (only when one is set) | — |

`Alt` is the time modifier because the existing drag already means exactly that
(`KeyframeGraph.tsx:211`: `e.altKey ? 'time'`), and `Shift` is the coarse multiplier because the
same line uses `shiftKey` for the *other axis* — reusing it for magnitude would collide. Time steps
are 0.01 s / 0.1 s: 0.01 s is ten times the graph's own 0.001 s "same keyframe" tolerance
(`:86`, `:311`, `:374`) so a fine nudge can never silently merge two keyframes, and 0.1 s is a tenth
of the graph's one-second gridlines (`:171-183`).

`NUDGE_STEPS`, a new `Record<AnimatableProperty, { fine: number; coarse: number }>` beside
`PROPERTY_RANGES`, in each property's own unit:

| Property | fine | coarse | unit |
|---|---|---|---|
| `x`, `y` | 0.01 | 0.1 | fraction of canvas (1% / 10%) |
| `scaleX`, `scaleY` | 0.01 | 0.1 | scale factor |
| `rotation` | 1 | 15 | degrees |
| `opacity` | 0.01 | 0.1 | 0–1 (1% / 10%) |
| `blur` | 1 | 5 | px |
| `volume` | 0.01 | 0.1 | 0–1 (1% / 10%) |

---

## Task 1 — the graph becomes a focusable listbox, and Delete stops deleting the clip

**Files:** `apps/artist/src/components/KeyframePanel/KeyframeGraph.tsx`,
`KeyframeGraph.module.css`, `KeyframeGraph.test.tsx` (four cases only),
new `apps/artist/src/components/KeyframePanel/KeyframeGraph.keyboard.test.tsx`.

**(1) RED commit — tests only, must fail.**
- [ ] In the new `KeyframeGraph.keyboard.test.tsx`, add
      `it('does not let Delete reach the editor\'s global shortcuts')`: render the graph with
      `opacityKeyframes()`, add a `window` `keydown` spy (`const seen = vi.fn(); window.addEventListener('keydown', seen)`,
      removed in `afterEach`), focus the `<svg>`, select the custom keyframe, press Delete with
      `userEvent.keyboard('{Delete}')`, and assert `seen` was **not** called while
      `onDeleteKeyframe` was. Fails today twice over: the svg is not focusable, and the graph's
      listener is itself on `window`.
- [ ] Add `it('puts the graph in the tab order and names it for the property')` — `user.tab()`
      reaches the `<svg>`; `screen.getByRole('listbox', { name: /opacity/i })` resolves to it.
      Fails today.
- [ ] Add `it('names every keyframe handle with its time, value and easing')` —
      `getAllByRole('option')` has length 2; the custom one's name matches
      `/50% at 1\.00 s, Linear/`; the auto-created 0 s one likewise. Fails today.
- [ ] **Commit:** `test(artist): pin the keyframe graph's missing keyboard surface red`

**(2) The implementation.**
- [ ] `<svg>` gains `tabIndex={0}`, `role="listbox"`, `aria-orientation="horizontal"`,
      `aria-label={\`Keyframes for ${propertyLabel}\`}` and
      `aria-activedescendant={activeId ?? undefined}`. `propertyLabel` is a new exported
      `PROPERTY_LABELS` record in `KeyframeGraph.tsx` (Position X / Position Y / Scale X / Scale Y /
      Rotation / Opacity / Blur / Volume — the strings `KeyframePanel.tsx:12-25` already uses; do
      **not** import them from `KeyframePanel`, that would invert the dependency).
- [ ] **Mark every decorative child `aria-hidden="true"`**: the grid `<g>` (`:387`), the curve
      `<path>` (`:424`), the playhead `<line>` (`:427`) and the help `<text>` (`:469`). Without
      this, axe's `aria-required-children` fails a `listbox` that has non-`option` children.
- [ ] Each keyframe `<circle>` gains `role="option"`, a stable
      `id={\`kf-${property}-${i}\`}`, `aria-selected={i === activeIndex}`, and an `aria-label` of
      `` `${formatValue(displayValue, property)} at ${displayTime.toFixed(2)} s, ${easingLabel}` ``
      — plus `, preset, not editable` when `!isCustom`. `easingLabel` is
      `EASING_TYPES.find(o => o.value === kf.easing)?.label ?? kf.easing` (`utils/easingOptions.ts`).
      The existing `<title>` child stays for the pointer tooltip; `aria-label` overrides it as the
      accessible name.
- [ ] New state `activeTime: number | null` — the active descendant, tracked **by time, not
      index**, because a time nudge re-sorts the array. `activeIndex` is derived:
      `keyframes.findIndex(kf => Math.abs(kf.time - activeTime) < 0.001)`. Unlike
      `selectedKeyframeTime` it may address a **preset** keyframe, so a screen-reader user can walk
      the whole curve. `selectedKeyframeTime` keeps its exact current meaning (custom only) and
      keeps driving `styles.selected`, the `r` radius and the easing select — nothing about
      `:372-374` changes.
- [ ] `handleKeyframeClick` / `handleKeyframeMouseDown` also set `activeTime` (for presets too) and
      call `svgRef.current?.focus()`, so click-then-Delete keeps working in Safari, which does not
      focus a `tabindex` element on mousedown.
- [ ] `handleGraphClick` clears `activeTime` alongside `selectedKeyframeTime`.
- [ ] **Delete the `window` keydown effect at `:233-244`.** Replace it with `onKeyDown` on the
      `<svg>`. In this task it handles only: `ArrowLeft`/`ArrowRight` (move active by ∓1, clamped to
      `[0, keyframes.length - 1]`, no wrap), `Home`/`End`, `Delete`/`Backspace` (only when
      `selectedKeyframe` is set **and** `onDeleteKeyframe` is given), and `Escape` (only when
      `activeTime !== null`). Moving the active option **also selects** it when it is custom, and
      clears `selectedKeyframeTime` when it is a preset — single-select follow-focus, the APG
      listbox default and the model the easing select already assumes.
- [ ] **Propagation contract, stated once in a comment above the handler and enforced by it:** the
      handler calls `e.preventDefault(); e.stopPropagation();` for `ArrowLeft`, `ArrowRight`,
      `ArrowUp`, `ArrowDown`, `Home`, `End` and `Enter` **unconditionally** while the graph is
      focused (a focused listbox owning its own arrows is the expected behaviour, and an
      unconditional swallow is one fewer branch to cover), and for `Delete`/`Backspace` and
      `Escape` **only when it acts**. Every other key — `Tab`, `Space`, `?`, `k`, letters — falls
      through untouched, so the shortcut sheet, play/pause and tool switching still work with the
      graph focused.
- [ ] `KeyframeGraph.module.css`: add `.graph:focus-visible` (copy the ring from
      `.easingSelect:focus-visible` at `:110`) and `.keyframePoint.active` (an outline distinct
      from `.selected` at `:68`, so the active descendant is visible on a preset).
- [ ] **Update the four existing tests that fire on `window`**: `:218`, `:230`, `:281` become
      `fireEvent.keyDown(svg, …)` (or `user.keyboard` after focusing); `:267`'s preset case keeps
      its assertions and drives the svg. `:348`'s `user.tab()` becomes two tabs (svg, then select) —
      keep the assertion that the select ends up focused. Nothing else in that file moves.
- [ ] **Commit:** `feat(artist): make the keyframe graph a focusable listbox with named handles`

**Reviewer checks**
- `git diff --stat apps/artist/src/components/KeyframePanel/KeyframeGraph.test.tsx` shows only the
  four window-driven cases and the tab count — no drag test touched.
- No `window.addEventListener` remains in `KeyframeGraph.tsx`.
- `getAllByRole('option')` counts **all** keyframes, presets included; `styles.selected` still
  appears on custom ones only.
- `apps/artist/vite.config.ts` floors unchanged in this task (re-measured in Task 3).

---

## Task 2 — nudging, adding and announcing

**Files:** `KeyframeGraph.tsx`, `KeyframeGraph.module.css`, `KeyframeGraph.keyboard.test.tsx`,
`KeyframePanel.test.tsx`.

- [ ] Add `NUDGE_STEPS` (table above) beside `PROPERTY_RANGES` (`:24-33`), plus
      `TIME_NUDGE = { fine: 0.01, coarse: 0.1 }`. Both with a comment giving the unit.
- [ ] **Value nudge** — `ArrowUp`/`ArrowDown`, `Shift` for coarse. Acts only when
      `selectedKeyframe` is set (a preset or an empty graph is a no-op that still swallows the key).
      New value `= clamp(kf.value ± step, range.min, range.max)`, exactly the drag's clamp (`:294`).
      Commits through `onKeyframeValueChanged(property, kf.time, newValue)` — the same callback the
      drag uses (`:325`), which `KeyframePanel.handleKeyframeValueChanged:158` already routes to
      `setClipKeyframe` preserving the stored easing.
- [ ] **Time nudge** — `Alt+ArrowLeft`/`Alt+ArrowRight`, `Shift` for coarse. New time
      `= clamp(kf.time ± step, 0, clipDuration)` (the drag's clamp, `:293`). **Refuse** the nudge
      (no call, no state change, key still swallowed) when another keyframe already sits within
      0.001 s of the target — `moveClipKeyframe` (`projectStore.ts:790`) would otherwise delete it
      silently. Otherwise call `onKeyframeMoved(property, kf.time, newTime)` and set **both**
      `activeTime` and `selectedKeyframeTime` to `newTime`, mirroring what the drag's mouseup does
      at `:328`.
- [ ] **Add at the playhead** — `Enter` calls
      `onAddKeyframe(property, clamp(playheadTime, 0, clipDuration), interpolateKeyframes(keyframes, playheadTime, defaultValue))`,
      so the new keyframe lands exactly on the curve the user can see, and then sets `activeTime`
      and `selectedKeyframeTime` to that time. `interpolateKeyframes` and `defaultValue` are already
      imported/derived (`:2`, `:93-98`, `:143`).
- [ ] **Live region.** Add, inside `div.graphWrap` and **always rendered** (never conditionally — a
      live region must exist before its content changes), a
      `<span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">`
      holding a `nudgeMessage` state, empty on mount. Every nudge, add and delete sets it to
      `` `${propertyLabel} ${formatValue(value, property)} at ${time.toFixed(2)} seconds` ``
      (delete: `` `${propertyLabel} keyframe at ${time.toFixed(2)} seconds deleted` ``). Copy the
      `role="status" aria-live="polite"` pairing from `app/NotificationToast.tsx:15`. Navigation
      does **not** write it — `aria-activedescendant` already makes the AT read the new option, and
      writing both double-announces.
- [ ] `KeyframeGraph.module.css`: add `.srOnly` (the standard 1px clip-rect pattern). None exists in
      artist today — grep confirms — so define it here rather than hunting for one.
- [ ] **Tests** (`KeyframeGraph.keyboard.test.tsx`), one per key and one per branch:
      value up/down fine, value up/down coarse, value clamped at `range.max` and at `range.min`,
      value nudge is a no-op on a preset and on an empty graph; time nudge left/right fine and
      coarse, clamped at 0 and at `clipDuration`, refused when a neighbour is within 0.001 s
      (assert `onKeyframeMoved` not called), and that a successful time nudge keeps the same
      keyframe selected (the easing select still shows its easing); `Enter` adds at the playhead
      with the interpolated value (drive `playheadTime: 2` through `renderGraph`); `Enter` on an
      empty-keyframe graph adds at the default value; the live region is empty on mount, carries
      the value after a nudge and the deletion message after a Delete.
- [ ] **One store-level test in `KeyframePanel.test.tsx`** inside `editing keyframes in the graph`
      (`:251`): focus the graph, `ArrowRight` to the custom keyframe, `ArrowUp`, and assert the
      clip's stored keyframe value moved by exactly one fine step and its easing is unchanged —
      the keyboard's counterpart to `:269` `changes a keyframe value, keeping its easing, when it
      is dragged vertically`.
- [ ] **Commit:** `feat(artist): nudge, add and announce keyframes from the keyboard`

**Reviewer checks**
- Both clamps are the drag's clamps, not new arithmetic.
- Every `if` added in this task has a test that takes its false branch — artist branches has ~1
  branch of headroom.
- The live region is unconditional in the JSX and empty on first render.
- No new store action; `KeyframePanel.tsx` is unchanged.

---

## Task 3 — the propagation contract, axe, and the re-measure

**Files:** `KeyframeGraph.keyboard.test.tsx`, `apps/e2e/tests/accessibility/core.spec.ts`,
`apps/artist/vite.config.ts`, `scripts/coverage-report.mjs`, root `CLAUDE.md` (table only).

- [ ] **The contract test, table-driven.** In `KeyframeGraph.keyboard.test.tsx`, a `window` keydown
      spy plus `it.each` over the owned keys — `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`,
      `Home`, `End`, `Enter` (always swallowed), `Delete`, `Backspace`, `Escape` (swallowed only
      when they act) — asserting the spy saw nothing. A second `it.each` over the **not** owned keys
      — `Tab`, `?`, `k`, `s`, `v`, `Space` — asserting the spy *did* see each one, so the editor's
      cascade and `PlaybackControls` keep working with the graph focused. A third case: with no
      keyframe selected, `Delete` and `Escape` **do** reach `window` (the global deselect/delete
      cascade is deliberately left to run).
- [ ] **e2e axe.** Extend the `ESCAPEARTIST Accessibility` describe
      (`apps/e2e/tests/accessibility/core.spec.ts:122`) with
      `test('keyframe graph passes axe-core audit and is keyboard reachable')`:
      `seedTextClip(page)` (`apps/e2e/utils/artist.ts:22`), press `k` to open the panel, click the
      `Opacity` property track to open the graph, then
      `runAxeCheck(page, { includeSelector: '[role="listbox"]', disableRules: ['color-contrast'] })`
      and assert zero serious/critical violations; then `page.keyboard.press('Tab')` until the
      listbox is `document.activeElement` and assert an `aria-activedescendant` appears after
      `ArrowRight`. The panel is a portal on `document.body` (`KeyframePanel.tsx:345`), so
      `includeSelector` reaches it.
- [ ] **Re-measure and raise the floors.** Run `pnpm --filter @escapesuite/artist test:coverage`,
      then `pnpm coverage:report`. Raise each of the four artist floors to the new achieved figure
      rounded **down** to a whole percent, in all three places at once. If any figure has *dropped*,
      do not lower a floor — find the uncovered branch and test it.
- [ ] **Commit:** `test(artist): pin the keyframe graph's key contract, add the axe check, raise the floors`

**Reviewer checks**
- The "not owned" list genuinely reaches `window` — a spy that never fires proves nothing if the
  positive cases are missing.
- `pnpm test:e2e` green locally for `tests/accessibility/core.spec.ts` before the PR.
- The three floor locations agree with each other and with `coverage:report`.

---

## Task 4 — documentation and the changeset

**Files:** `apps/artist/CLAUDE.md`, `apps/artist/src/components/KeyboardShortcuts/KeyboardShortcuts.tsx`
(+ its test), `KeyframeGraph.tsx` (the on-screen help line), `.changeset/<name>.md`.

- [ ] **`apps/artist/CLAUDE.md`, "Keyframe Panel" section (`:176-183`)** — add a `KeyframeGraph.tsx`
      sub-entry giving the full key map table above, the exact step sizes and their units, the
      listbox/`aria-activedescendant` choice and *why* (single tab stop; presets are visitable but
      not editable; decorative children are `aria-hidden` so axe's `aria-required-children`
      passes), and the propagation contract in one sentence — which keys the graph swallows, which
      it lets through, and that it is React's root-container listener plus
      `SyntheticEvent.stopPropagation()` that shields `useAppKeyboardShortcuts` and
      `PlaybackControls`. Note the fixed bug: Delete used to delete the whole clip.
- [ ] **`KeyboardShortcuts.tsx`** — add a seventh group, `Keyframe Graph`, after `Panels`
      (`:59-65`), listing: `←`/`→` previous/next keyframe, `Home`/`End` first/last, `↑`/`↓` nudge
      value, `Shift`+`↑`/`↓` nudge value (coarse), `Alt`+`←`/`→` nudge time, `Alt`+`Shift`+`←`/`→`
      nudge time (coarse), `Enter` add keyframe at playhead, `Delete` delete keyframe, `Escape`
      clear selection. Keep the existing `keys: string[]` shape so the renderer (`:98-112`) is
      untouched. Update `KeyboardShortcuts.test.tsx` if it counts groups or rows.
- [ ] **The graph's own help `<text>` (`KeyframeGraph.tsx:475`)** — it currently advertises three
      pointer verbs. Change to `Double-click to add • Drag to move • Arrow keys to navigate` and
      keep it `aria-hidden` (Task 1). The `<title>` child's "(Drag to move, Right-click or Delete
      key to remove)" (`:462`) stays — it is the pointer tooltip.
- [ ] **Changeset** — `.changeset/keyframe-graph-keyboard.md`, `patch` for `@escapesuite/artist`
      only, user-facing wording, e.g.:
      *"The keyframe graph is now fully keyboard-operable: Tab into it, move between keyframes with
      the arrow keys, nudge a keyframe's time and value, add one at the playhead with Enter, and
      delete with Delete. Screen readers announce each keyframe's time, value and easing. Fixes a
      bug where pressing Delete with a keyframe selected deleted the whole clip."*
- [ ] **Commit:** `docs(artist): document the keyframe graph's keyboard map`

**Reviewer checks**
- The key map in `CLAUDE.md`, in `KeyboardShortcuts.tsx` and in the code's `NUDGE_STEPS` agree
  exactly — three copies, one truth.
- The changeset is `patch` and names only `@escapesuite/artist`.

---

## Open questions / rulings needed

1. **Real focusable handles vs. one focusable SVG with `aria-activedescendant`.**
   *Recommendation: one focusable `<svg role="listbox">` with `aria-activedescendant`* — it adds a
   single tab stop instead of N, it is the APG-sanctioned alternative to a roving tabindex for
   listbox, and `tabindex` on SVG **child** elements has the shakier browser/AT story of the two
   (Safari in particular). It is verified to work in the test environment: `jsdom@30.0.1` focuses an
   `<svg tabindex="0">` and reports it as `document.activeElement`. The cost is that
   `aria-activedescendant` is announced less reliably than real focus on a handful of older ATs —
   which is precisely what the `aria-live` region in Task 2 covers. Flip to a roving tabindex on the
   `<circle>`s only if manual VoiceOver/NVDA testing shows the active option going unannounced.
2. **Should each arrow-key nudge be its own undo step?** Every store action pushes history
   (`projectStore.ts:662,741,777`), so holding `ArrowUp` fills the undo stack, whereas one drag is a
   single entry. *Recommendation: accept it for this PR* — it matches the inspector's numeric
   controls, and coalescing would need a new store concept (a history transaction) that belongs in
   its own ticket. Note it in the PR body.
3. **Does `Enter` or `Insert` add a keyframe?** *Recommendation: `Enter`* — `Insert` does not exist
   on most Mac keyboards, and `Enter` is free once navigation selects on move. If a reviewer wants
   an "activate" semantic for `Enter` instead, the add moves to `Shift+Enter` and navigation is
   unaffected.
4. **Pressing Delete with the graph focused but nothing selected.** This plan lets it through to the
   global cascade, which deletes the selected **clip**. *Recommendation: keep it* — it is today's
   behaviour minus the double-fire, and swallowing Delete inside a focused graph that has no
   selection would silently break a documented editor shortcut. Worth a reviewer's explicit
   blessing, since it is the one path where a keystroke aimed at the graph affects the timeline.
5. **Should navigation visit preset keyframes?** This plan says yes (visitable, announced as
   "preset, not editable", not selectable or editable) so the curve is fully perceivable by a
   screen-reader user. The alternative — skipping them — is simpler but hides half the curve.

### Rulings (controller, 2026-09-13)

1. **One focusable `<svg role="listbox">` with `aria-activedescendant`** — accepted as recommended; flip to a roving tabindex only on manual AT evidence.
2. **One undo step per nudge** — accepted for this PR; note it in the PR body; a history transaction is its own ticket.
3. **`Enter` adds a keyframe at the playhead** — accepted.
4. **Delete with the graph focused and nothing selected falls through to the global clip delete** — accepted (today's behaviour minus the double-fire, ESCSUITE-49); pin it with a test so the fall-through is deliberate, not accidental.
5. **Navigation visits preset keyframes**, announced as preset/not editable — accepted.
