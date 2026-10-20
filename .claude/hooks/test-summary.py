"""Print only the useful part of a test run's output. Called by filter-test-output.sh."""
import re, sys

log, rc = sys.argv[1], int(sys.argv[2])
lines = open(log, errors="replace").read().splitlines()
ansi = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
plain = [ansi.sub("", l) for l in lines]

summary = re.compile(r"(^ℹ (tests|pass|fail) |Test Files|Tests\s+\d|Tasks:|test result:|\d+ (passed|failed|error)|^# (tests|pass|fail) \d|^(ok|FAIL)\s+\S+\s+(\(cached\)|[\d.]+s)|^(PASS|FAIL)$|Ran \d+ tests?|=+ .*(passed|failed|error).* =+)", re.I)
failure = re.compile(r"(FAIL|ERROR|Error:|error(\[|:)|panicked|AssertionError|Traceback|✗|✖|×|FAILED|not ok)")

out = []
if rc != 0:
    keep = set()
    for i, l in enumerate(plain):
        if failure.search(l):
            keep.update(range(i, min(i + 8, len(plain))))
    out = [plain[i] for i in sorted(keep)][:150]
out += [l for l in plain if summary.search(l)][-20:]
if not out:
    out = plain[-15:]

print("\n".join(dict.fromkeys(out)))  # dedupe, keep order
print(f"[test output filtered: {len(lines)} lines -> {len(out)}; exit {rc}; full log: {log}]")
