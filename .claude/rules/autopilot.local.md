# Autopilot: local rules for this repository

This file belongs to this repository. `bin/vendor-claude-setup` in bonham-ops created it
once and never changes it, so rules here survive every refresh of the vendored policy.
It loads in every session, like `.claude/rules/autopilot.md`.

Where this file conflicts with the autopilot policy (`.claude/rules/autopilot.md` and the
role files in `.claude/autopilot/`), this file wins, except for the hard rules
(**Always**) and the `ap-owner-merge` criteria, which it can only make stricter.

Put each rule under a heading that names the policy section it changes, such as
`## Ticket classes`, `## Steward` or `## Builder, step 2`, and say whether it adds to
that section or replaces part of it. A rule that applies only to one role is still read
by every role, so name the role.

## Ticket classes: protected editor paths

Adds to the `ap-owner-merge` list (stricter). Moved here from the vendored policy, where
ESCAPESUITE #933 added it.

**Protected editor paths (temporary).** Until ESCSUITE-348, -349, -350 and -351 are all
Done and green on `main`, a diff touching any of these in `apps/artist/src/` is also
`ap-owner-merge`: `components/Preview/**`, `components/Timeline/**`,
`store/clipSlice.ts`, `store/historySlice.ts`, `store/projectMigration.ts`,
`core/projectFileFormat.ts`, `core/projectManager.ts`, `utils/waveform.ts` and
`core/audioMixer.ts`. Once all four tickets are Done, the rule lapses: the steward says
so in the next digest and files an `ap-owner-merge` ticket to delete this paragraph.

## Steward: regression specs and flaky e2e tests

The steward role only. Adds two items to the steward's filing rules, before "Score each
dimension 1–5". Moved here from the vendored policy, where ESCAPESUITE #933 and #943
added them.

- **Regression specs.** List bug tickets closed since the last sweep whose symptom is
  visible in the UI but which landed no `apps/e2e/tests/regressions/<KEY>.spec.ts`, and
  file a P2 `ap-auto` ticket for each one to add it.
- **Flaky e2e tests.** Read the `e2e-flaky` lists from the last 7 days of `main` runs (recipe in
  `docs/reference/ci-cd-pipeline.md`) and file a ticket for any test flaky more than once.

## Builder, step 2: a Playwright test for UI bugs

The builder role only. Adds to step 2 ("Write a failing test first"). Moved here from the
vendored policy, where ESCAPESUITE #933 added it.

**A bug whose symptom shows in the UI** (playback, preview, waveform, timeline
editing, save/load, export) also needs a Playwright test at
`apps/e2e/tests/regressions/<KEY>.spec.ts` that fails before the fix. A unit test
alone doesn't meet this step. Use the media-health helpers in `apps/e2e/utils/` where
they exist. Where the container can't run it (e.g. H.264/AAC media), let CI prove it
and say so in the PR.

## Builder, step 4: the reviewer checks the test's layer

The `reviewer` subagent, when the builder hands it a diff. Adds to its checklist. Moved
here from a hand edit of the vendored `.claude/agents/reviewer.md`, which a refresh
overwrites.

Check the test is at the layer where the bug is visible: if the user sees it in the
browser, a Playwright test must fail without the change, not only a unit test (the
**Builder, step 2** rule above). Block on a UI bug fixed with a unit test alone.

## Main must stay green, step 1: the nightly

Every role that runs **Main must stay green**. Adds to step 1. Moved here from the
vendored policy, where ESCAPESUITE #933 added it.

Once a nightly workflow exists (ESCSUITE-353), also check its latest run on `main`: a
red nightly counts as a red `main` for steps 2 and 3 of **Main must stay green**.
