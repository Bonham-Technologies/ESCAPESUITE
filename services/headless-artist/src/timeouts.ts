/**
 * The largest delay `setTimeout`, `AbortSignal.timeout` and friends can represent. Node clamps
 * any larger value to 1 ms rather than refusing it (and a value above `2**32 - 1` throws
 * `ERR_OUT_OF_RANGE` from inside the timer itself), so a millisecond timeout accepted at
 * validation time must never exceed this bound — otherwise the number an operator configured
 * means close to the opposite of what they asked for: the deadline fires at once instead of
 * never.
 *
 * Shared by every parser that accepts a millisecond timeout from the outside: `cli.ts`'s
 * `HEADLESS_TIMEOUT_MS`, and the `webhook` and `command` sinks' `config.timeoutMs`.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647 // 2^31 - 1, ~24.86 days
