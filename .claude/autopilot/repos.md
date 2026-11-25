<!-- Vendored from bonham-ops, policy v45. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: registry and repo runs (background: bonham-ops `docs/ops/one-project.md`)

## Registry

bonham-ops's `autopilot/fleet.json` lists every repo once, each with a `lane`
(`products`, `sites`, `platform` or `prototypes`) and a `level`:

- **autopilot:** steward, scout and a nightly builder, as the rest of this policy says.
- **on-request:** no scheduled task. A builder takes its tickets only in a thread where
  the owner asked for it. Every PR waits for the owner's merge, whatever the ticket's
  class: label it `needs-owner`, and never merge it or turn on auto-merge. The fleet run
  reviews it weekly.
- **tracked:** read-only, one section in the fleet digest. No role ever writes to it: no
  push, branch, PR, comment, label, issue or vendored policy. Tickets about it go in its
  entry's Jira project (under its `epic`, if any), never in the repo.

Only `autopilot` repos get scheduled tasks, a control-panel row, the vendored policy and
refresh PRs; `bin/propagate`, `bin/vendor-claude-setup`, `bin/fleet tasks` and
`bin/fleet drift` skip the others. `bin/fleet list` prints each entry's level and lane.

## Repo runs

A prompt with no `Repo:` line runs in its own checkout, exactly as before. A prompt with
`Repo: <owner>/<repo>` works only in that repo, under the rules of the repo the run works in.
Steps 1 and 2, and **Each repo due today**, run only from bonham-ops; a run already
working in that repo's checkout has done them and never attaches again.

1. In the bonham-ops checkout, `bin/fleet repo "<prompt>"` prints the entry: name, repo,
   Jira key, record, level and lane. It refuses a repo `fleet.json` doesn't list and a
   `tracked` one: stop there. A scheduled run stops on an `on-request` one too.
2. Attach the repo with `add_repo` (`access: push`; read access gives no `gh api` on a
   public repo), clone it once, then call `register_repo_root` on the checkout.
3. Read that checkout's `.claude/rules/autopilot.md`, `.claude/rules/autopilot.local.md`,
   the role's files under `.claude/autopilot/` and its `CLAUDE.md` explicitly. They
   decide the work over the rules that loaded from bonham-ops, which govern only
   bonham-ops work; the hard rules (**Always**) of both still hold. An `on-request` repo
   without them (it gets no vendored policy) works under bonham-ops's rules.
4. Run every git command as `git -C <checkout>`, and every `gh api`, verify and scanner
   command from inside the checkout, so `{owner}/{repo}` names that repo. Install its
   dependencies first, as its `CLAUDE.md` says, and run its prep command, if it names one, before verify. Push with `git -c push.negotiate=true`;
   fetch `main` with a bounded `--depth` before update-branch work.
5. The Jira key, Confluence record and control-panel row (by `Jira`) are the entry's.
6. If the attach, the clone or the first push fails, stop: say exactly what failed in the
   summary, leave the repo's tickets alone, and never mock it.

## Each repo due today

A steward or scout prompt may say "each repo due today". Read the control panel once;
then, for each `autopilot` entry in `fleet.json` order, decide its day as **Control
panel** and **Catch-up** say (`bin/fleet due`), and run the role for each due repo as a
**Repo run**, one repo at a time, each leaving its own digest or Session Log trace; a
failed attach stops only that repo's run. bonham-ops runs in this checkout, with no
attach, and its steward turn is the fleet role. If the session runs short, stop after a
whole repo and name the repos left; catch-up takes them.
