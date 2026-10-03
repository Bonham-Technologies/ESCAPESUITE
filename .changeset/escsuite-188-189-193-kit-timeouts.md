---
'@escapesuite/headless-artist': patch
---

Timeouts that used to silently mean the opposite of what you asked for now refuse the bad value and bound the cases nothing used to bound.

`HEADLESS_TIMEOUT_MS` and a `webhook` sink's `config.timeoutMs` now refuse any value above 2147483647 ms (2^31-1, ~24.8 days — the largest delay a timer can represent), naming the bound, instead of accepting it and letting Node's own timers silently clamp it to about 1 ms, which used to fail every render or every webhook delivery instantly. The `command` sink gets a delivery budget of its own (`config.timeoutMs`, default 5 minutes, same bound): a delivery command that outruns it is sent `SIGTERM`, then `SIGKILL` two seconds later if it is still alive, and the job fails with `command sink timed out after <n> ms` rather than holding a worker slot forever. `serve`'s drain is bounded accordingly — by the render timeout plus whatever the job's own delivery sink budgets for itself, not by the render alone. `serve` also now disconnects a client that never finishes sending its request: the server sets its own request/headers timeouts (30s/10s, well under Node's 300s/60s defaults), and a shutdown no longer waits on a request whose body has not finished arriving — it is answered 408 (or simply disconnected) immediately instead of parking the drain on bytes that might never come.
