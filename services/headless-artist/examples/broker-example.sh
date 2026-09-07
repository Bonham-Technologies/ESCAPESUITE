#!/usr/bin/env bash
#
# A minimal broker: drain a directory of job specs, one render at a time.
#
# The CLI is a one-shot process — it renders one job, writes exactly one JSON outcome line to
# stdout, and exits. Everything a scheduler needs is in the exit code:
#
#   0  rendered; the outcome line carries outputLocation and the render metadata
#   1  the job failed; the outcome line carries `error`. Usually worth a retry
#   2  the spec (or the CLI invocation) is wrong. Never retry — it will fail identically
#
# Renders are idempotent by jobId: the volume and s3 sinks write `<jobId>.<ext>` and
# `<jobId>.manifest.json`, overwriting whatever was there. A retry of a job that half
# succeeded leaves one correct output, not two.
#
# Usage: JOB_DIR=./jobs OUT_DIR=./out ./broker-example.sh

# No `set -e`: the whole point here is to inspect exit codes rather than die on them.
set -uo pipefail

CLI=${CLI:-headless-artist}
JOB_DIR=${JOB_DIR:-./jobs}
DONE_DIR=${DONE_DIR:-$JOB_DIR/done}
RETRY_DIR=${RETRY_DIR:-$JOB_DIR/retry}
REJECT_DIR=${REJECT_DIR:-$JOB_DIR/rejected}
LOG_DIR=${LOG_DIR:-$JOB_DIR/logs}

mkdir -p "$DONE_DIR" "$RETRY_DIR" "$REJECT_DIR" "$LOG_DIR"

shopt -s nullglob
for job in "$JOB_DIR"/*.json; do
  name=$(basename "$job" .json)
  echo "=== $name"

  # stdout is the machine-readable outcome; stderr is the human-readable log. Keep them apart.
  outcome=$("$CLI" render --job "$job" 2>"$LOG_DIR/$name.log")
  status=$?

  case $status in
    0)
      # Where the output landed is the sink's business, so read it from the outcome rather
      # than guessing. (The command sink reports no manifestLocation — see the README.)
      location=$(printf '%s' "$outcome" | node -e \
        'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).outputLocation))')
      echo "ok  -> $location"
      printf '%s\n' "$outcome" >"$LOG_DIR/$name.outcome.json"
      mv "$job" "$DONE_DIR/"
      ;;
    1)
      echo "fail -> retryable; see $LOG_DIR/$name.log"
      printf '%s\n' "$outcome" >"$LOG_DIR/$name.outcome.json"
      mv "$job" "$RETRY_DIR/"
      ;;
    *)
      # Exit 2 (or anything unexpected): stdout is empty, the reason is on stderr.
      echo "bad  -> rejected; see $LOG_DIR/$name.log"
      mv "$job" "$REJECT_DIR/"
      ;;
  esac
done
