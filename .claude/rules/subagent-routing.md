<!-- Vendored from bonham-ops (c8ca056). Edit there and re-run bin/vendor-claude-setup. -->
## Subagent model routing
Always pass an explicit `model` when spawning a subagent. Choose by how novel the task is, what a failure would cost, and whether success can be checked mechanically.

- **sonnet**: read-only search and exploration (including Explore); running tests, builds or linters and summarizing; mechanical edits with an exact spec; implementation only when the spec names the files, the interfaces and a verifying test command.
- **opus** (default for real engineering): logic where the spec leaves design choices open; debugging with a known repro; reviewing and fixing sonnet's work; anything touching auth, crypto, permissions, data integrity, migrations or concurrency.
- **fable**: architecture and interface decisions; novel algorithms; debugging that opus already failed; final QC on substantial or high-risk changes.

When unsure, pick the higher tier for work that writes code and the lower tier for read-only work.

**Escalation:** a sonnet failure goes to opus with the failure details, never a second sonnet attempt. If opus fails twice, handle it in the main session. Mention every escalation in your summary.

**Pipeline for substantial changes:** `builder` (sonnet, precise testable specs only) → `reviewer` (opus) → `qc` (fable, high-risk changes only). For novel or loose specs, skip builder and go straight to opus. Skip reviewer for trivial changes with passing tests. Tests and verification commands are the first reviewer; don't add model hops where a test would do.

**Handoffs:** give every subagent the goal, file paths, acceptance criteria and the verify command. Ask for a short report: files changed, checks run with results, open risks. Pass review and QC agents the diff and the spec, not a request to explore.
