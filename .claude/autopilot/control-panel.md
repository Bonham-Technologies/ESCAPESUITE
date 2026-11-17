<!-- Vendored from bonham-ops, policy v31. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: control panel

## Control panel

At the start of the run, read this project's row (by `Jira`) in the **Settings** table of
the OPS page `space = OPS AND type = page AND title = "Autopilot control panel"`. Only
the owner edits **Settings**; never write to it. Ignore case and spaces in a cell; an old
column name still counts (`Paused` is `Builder paused`).

| Role | Days | Paused | Numbers | Fallbacks |
|---|---|---|---|---|
| builder | `Build days` | `Builder paused` | `Builder budget`, `Feature cap` | every day; the prompt's `Fallback ticket budget: N` (or `Ticket budget: N`); 8 |
| dependabot task | every day | `Builder paused`: while paused it stops untriaged; the builder's nightly sweep still runs | none | not paused |
| steward | `Steward days` | `Steward paused` | `Steward ticket cap` | when the newest digest is 7 or more days old; 25 |
| scout | `Scout days` | `Scout paused` | `Scout proposals` | the 1st and 15th; 5 |

- **Days:** `daily`, `none`, or a comma list mixing weekdays (`Tue`, `Tuesday`), weekday
  ranges (`Mon-Fri`; `Fri-Mon` wraps), days of the month 1 to 31 (a month without that
  day skips it), day ranges (`1-7`) and `last`, such as `Mon,15,last`. A day matches when
  any item matches the run's start date in America/Denver.
- **Paused:** `no`, `yes`, or `until YYYY-MM-DD` (paused through that date).
- **Numbers:** any whole number from 0, no upper limit. A run stops early when ready work
  or its session runs out, and says which.
- **Fallbacks** (paused: `no`) apply per cell, only when the page, row or cell is missing
  or blank or doesn't parse. Never guess. The summary (a steward's digest) names each
  fallback, its column and the value read. `bin/fleet check-panel` applies these rules.
- **Catch-up** (steward and scout, BORG-99): on a day outside its days, the run goes ahead
  when its most recent due day (in its days and not paused) is at most 3 days back and left
  no trace dated that day or later (America/Denver): the steward's digest comment; the
  scout's `· autopilot scout` Session Log entry, live or archived, or an `ap-scout` ticket.
  That trace says "caught up <due date>". Never while paused or with no Session Log page; a
  catch-up leaves a trace, so one per due day. A days fallback isn't a days cell: the
  steward's needs no catch-up, the scout's is `1,15`. `bin/fleet due` decides the same way.
