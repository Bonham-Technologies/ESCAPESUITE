<!-- Vendored from bonham-ops, policy v20. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: control panel

## Control panel

At the start of the run, read this project's row (by `Jira`) in the **Settings** table of
the OPS page `space = OPS AND type = page AND title = "Autopilot control panel"`. Only
the owner edits **Settings**; never write to it. Ignore case and spaces in a cell; an old
column name still counts (`Paused` is `Builder paused`).

| Role | Days | Paused | Numbers | Fallbacks |
|---|---|---|---|---|
| builder | `Build days` | `Builder paused` | `Builder budget`, `Feature cap` | every day; the prompt's `Fallback ticket budget: N` (or `Ticket budget: N`); 8 |
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
