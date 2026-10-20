#!/bin/bash
# PreToolUse(Bash): run plain test-runner commands through test-summary.py so only
# failures, errors and the summary come back. Based on the "Manage costs" docs example,
# but keeps the runner's exit status and saves the full log for follow-up reads.
# Opt out for one run by piping the command anywhere (e.g. `pnpm test | cat`).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input=$(cat)

# A copy vendored into a repo's .claude/ (bin/vendor-claude-setup) defers to the
# machine-wide one when that is installed, so the two never both rewrite a command.
canonical="${BONHAM_OPS_DIR:-$HOME/Projects/bonham-ops}/hooks"
if [ "$here" != "$(cd "$canonical" 2>/dev/null && pwd)" ] && [ -x "$canonical/filter-test-output.sh" ] \
   && [ "$(basename "$(dirname "$here")")" = ".claude" ]; then
  echo '{}'
  exit 0
fi
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")

runner='(npm|pnpm|yarn|bun)( run)? test(:run|:unit)?|pnpm( --filter[= ][^ ]+)? (exec )?(vitest|test)|(npx |pnpm exec )?vitest run|(uv run |poetry run |python3? -m )?pytest|cargo (nextest run|test)|go test|make test|turbo (run )?test(:run)?|node --test'
# Only a single plain runner invocation, optionally after `cd <dir> &&`. Anything with
# pipes, redirects, chaining or substitution is left alone.
if [[ "$cmd" =~ ^(cd\ [^\;\&\|\<\>\`\$]+\ \&\&\ )?($runner)([\ ][^\;\&\|\<\>\`\$]*)?$ ]]; then
  wrapped="log=\$(mktemp \"\${TMPDIR:-/tmp}/claude-test-XXXXXX\"); ( $cmd ) >\"\$log\" 2>&1; rc=\$?; python3 \"$here/test-summary.py\" \"\$log\" \$rc; (exit \$rc)"
  jq --arg c "$wrapped" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: (.tool_input + {command: $c})}}' <<<"$input"
else
  echo '{}'
fi
