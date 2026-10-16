// Seeded mutation fuzzing for the kit's input parsers (ESCSUITE-294).
//
// One harness per package: apps/artist/src/test/fuzz.ts is the same
// API, written out again, because neither package imports the other's test
// utilities. Keep the two files in step.
//
// Everything here is deterministic. A fuzz test fixes its seed, draws every
// choice from `createRng(seed)`, and describes each mutation in words, so a
// failure message (seed, iteration, mutation, error) is enough to reproduce
// the one input that broke the contract: rerun the file, or build that input
// by hand from the description.
//
// What a fuzz test asserts is a parser's refusal contract, not its happy path:
// every input either parses or is refused by name, and nothing else escapes.
// `expectNamedRefusal` is that assertion.

/** A small seeded PRNG: mulberry32, written out so the harness depends on nothing. */
export interface Rng {
  /** A float in [0, 1). */
  next(): number
  /** A whole number in [0, maxExclusive). */
  int(maxExclusive: number): number
  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive)
  return { next, int, pick: (items) => items[int(items.length)] }
}

/** `0x5eed` as a hex literal, the way a failure message prints a seed. */
export const formatSeed = (seed: number): string => `0x${(seed >>> 0).toString(16)}`

// ---------------------------------------------------------------------------
// Byte mutations. Each returns a new array and leaves its input untouched.
// ---------------------------------------------------------------------------

/** The first `length` bytes. */
export function truncateAt(bytes: Uint8Array, length: number): Uint8Array<ArrayBuffer> {
  return bytes.slice(0, Math.max(0, Math.min(length, bytes.length)))
}

/** The same bytes with bit `bit` (0 is the low bit of byte 0) inverted. */
export function flipBit(bytes: Uint8Array, bit: number): Uint8Array<ArrayBuffer> {
  const out = bytes.slice()
  out[bit >> 3] ^= 1 << (bit & 7)
  return out
}

/**
 * The same bytes with the little-endian u32 length field at `offset` moved by
 * `delta`, clamped to what a u32 holds. For a header whose length field is
 * known, where a random bit flip would mostly land somewhere dull.
 */
export function resizeDeclared(bytes: Uint8Array, offset: number, delta: number): Uint8Array<ArrayBuffer> {
  const out = bytes.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const declared = view.getUint32(offset, true) + delta
  view.setUint32(offset, Math.max(0, Math.min(0xffffffff, declared)), true)
  return out
}

export interface Span {
  offset: number
  length: number
}

/** `a` and `b` (in that order, not overlapping) exchanged; the lengths may differ. */
export function swapRanges(bytes: Uint8Array, a: Span, b: Span): Uint8Array<ArrayBuffer> {
  if (a.offset + a.length > b.offset) throw new Error('swapRanges: a must end before b starts')
  const at = (span: Span) => bytes.subarray(span.offset, span.offset + span.length)
  const parts = [
    bytes.subarray(0, a.offset),
    at(b),
    bytes.subarray(a.offset + a.length, b.offset),
    at(a),
    bytes.subarray(b.offset + b.length),
  ]
  const out = new Uint8Array(bytes.length)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

// ---------------------------------------------------------------------------
// JSON-value mutations. Each deep-copies its input and leaves it untouched.
// ---------------------------------------------------------------------------

export type JsonPath = Array<string | number>

/** `project.timeline.clips[0].id`, for a failure message. */
export function formatPath(path: JsonPath): string {
  if (path.length === 0) return '(root)'
  return path
    .map((key, i) => (typeof key === 'number' ? `[${key}]` : i === 0 ? key : `.${key}`))
    .join('')
}

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
  typeof value === 'object' && value !== null

/** Every node's path, the root (`[]`) first, depth-first. */
export function jsonPaths(value: unknown, path: JsonPath = []): JsonPath[] {
  const paths: JsonPath[] = [path]
  if (Array.isArray(value)) {
    value.forEach((item, i) => paths.push(...jsonPaths(item, [...path, i])))
  } else if (isContainer(value)) {
    for (const [key, item] of Object.entries(value)) paths.push(...jsonPaths(item, [...path, key]))
  }
  return paths
}

function getAt(value: unknown, path: JsonPath): unknown {
  return path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], value)
}

/** A deep copy with the node at `path` replaced by `replacement`. */
export function setAt(value: unknown, path: JsonPath, replacement: unknown): unknown {
  if (path.length === 0) return replacement
  const copy = structuredClone(value)
  const parent = getAt(copy, path.slice(0, -1)) as Record<string | number, unknown>
  parent[path[path.length - 1]] = replacement
  return copy
}

/** A deep copy with the key at `path` gone (an array element is spliced out). */
export function deleteKey(value: unknown, path: JsonPath): unknown {
  if (path.length === 0) return undefined
  const copy = structuredClone(value)
  const parent = getAt(copy, path.slice(0, -1))
  const key = path[path.length - 1]
  if (Array.isArray(parent)) parent.splice(key as number, 1)
  else delete (parent as Record<string, unknown>)[key as string]
  return copy
}

/** The values a node is swapped for: one of every JSON type, and `undefined`. */
export const TYPE_SWAPS: readonly unknown[] = [null, true, false, 0, 1, '', 'x', [], {}, undefined]

const typeOf = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value)

/** A deep copy with the node at `path` replaced by `replacement`, a value of another type. */
export function swapType(value: unknown, path: JsonPath, replacement: unknown): unknown {
  return setAt(value, path, replacement)
}

/** The numbers a parser most often forgets: not finite, negative, past exact, past huge. */
export const INJECTED_NUMBERS: readonly number[] = [NaN, Infinity, -Infinity, -1, 2 ** 53, 1e308]

/** A deep copy with the node at `path` replaced by the number `n`. */
export function injectNumber(value: unknown, path: JsonPath, n: number): unknown {
  return setAt(value, path, n)
}

/** `depth` arrays and objects, alternately, one inside the next, around an empty object. */
export function nestDeep(depth: number): unknown {
  let node: unknown = {}
  for (let i = 0; i < depth; i++) node = i % 2 === 0 ? [node] : { a: node }
  return node
}

/**
 * A deep copy with the node at `path` made an array of `n` entries: an array
 * is grown by repeating its own elements (or `null`s, when it is empty), and
 * anything else becomes `n` copies of itself.
 */
export function growArray(value: unknown, path: JsonPath, n: number): unknown {
  const node = getAt(value, path)
  const seed: unknown[] = Array.isArray(node) ? (node.length > 0 ? node : [null]) : [node]
  return setAt(
    value,
    path,
    Array.from({ length: n }, (_, i) => structuredClone(seed[i % seed.length]))
  )
}

/** A mutated input and the words that reproduce it. */
export interface Mutated<T = unknown> {
  value: T
  description: string
}

const formatValue = (value: unknown): string => {
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value)
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

/** One random JSON mutation of `value`, drawn from `rng`. Depths and lengths stay bounded. */
export function mutateJson(rng: Rng, value: unknown): Mutated {
  const paths = jsonPaths(value)
  const path = rng.pick(paths)
  const where = formatPath(path)
  // The root cannot be deleted from its parent: it has its type swapped instead.
  const op = rng.int(5)
  switch (op === 0 && path.length === 0 ? 1 : op) {
    case 0:
      return { value: deleteKey(value, path), description: `deleteKey ${where}` }
    case 1: {
      const current = typeOf(getAt(value, path))
      const replacement = rng.pick(TYPE_SWAPS.filter((swap) => typeOf(swap) !== current))
      return {
        value: swapType(value, path, replacement),
        description: `swapType ${where} -> ${formatValue(replacement)}`,
      }
    }
    case 2: {
      const n = rng.pick(INJECTED_NUMBERS)
      return { value: injectNumber(value, path, n), description: `injectNumber ${where} -> ${formatValue(n)}` }
    }
    case 3: {
      const depth = 1 + rng.int(200)
      return { value: setAt(value, path, nestDeep(depth)), description: `nestDeep ${where} -> depth ${depth}` }
    }
    default: {
      const n = 2 + rng.int(300)
      return { value: growArray(value, path, n), description: `growArray ${where} -> ${n} entries` }
    }
  }
}

// ---------------------------------------------------------------------------
// The contract.
// ---------------------------------------------------------------------------

/** Enough to rerun one failing input: the seed, the iteration and the mutation. */
export interface FuzzContext {
  seed: number
  iteration: number
  mutation: string
}

const describeError = (error: unknown): string =>
  error instanceof Error
    ? `${error.constructor.name}: ${error.message}`
    : `a thrown non-Error ${formatValue(error)}`

/** A broken contract: the one error a fuzz case fails with. */
export class FuzzContractError extends Error {
  name = 'FuzzContractError'
}

/** Fail one fuzz case with everything needed to reproduce it. */
export function fuzzFailure(context: FuzzContext, problem: string): FuzzContractError {
  return new FuzzContractError(
    `fuzz contract broken (seed ${formatSeed(context.seed)}, iteration ${context.iteration}): ${problem}\n` +
      `  mutation: ${context.mutation}`
  )
}

/** Long enough for any real parse; short enough that a hang fails the case instead of stalling the file. */
export const FUZZ_CASE_TIMEOUT_MS = 2000

const HUNG = Symbol('hung')

export type RefusalOutcome<T> = { ok: true; value: T } | { ok: false; error: Error }

/**
 * Run one mutated input through a parser. Passes when `run` returns (or
 * resolves), or when it throws (or rejects) an error that `isExpected` accepts
 * and that carries a non-empty message: a named refusal. Anything else fails
 * with the seed, iteration and mutation: an unexpected error class, an empty
 * message, a thrown non-Error, or a promise still pending after
 * `FUZZ_CASE_TIMEOUT_MS`. (A synchronous infinite loop cannot be raced; it
 * hangs the file, which vitest's own timeout then reports.)
 *
 * Returns the outcome, so a caller can go on to check the shape of what
 * parsed.
 */
export async function expectNamedRefusal<T>(
  run: () => T | Promise<T>,
  isExpected: (error: unknown) => boolean,
  context: FuzzContext,
  timeoutMs: number = FUZZ_CASE_TIMEOUT_MS
): Promise<RefusalOutcome<Awaited<T>>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const settled = await Promise.race([
      (async () => run())(),
      new Promise<typeof HUNG>((resolve) => {
        timer = setTimeout(() => resolve(HUNG), timeoutMs)
      }),
    ])
    if (settled === HUNG) throw fuzzFailure(context, `still pending after ${timeoutMs} ms`)
    return { ok: true, value: settled as Awaited<T> }
  } catch (error) {
    if (error instanceof FuzzContractError) throw error
    if (!isExpected(error)) throw fuzzFailure(context, `escaped as ${describeError(error)}`)
    if (!(error instanceof Error) || error.message.length === 0) {
      throw fuzzFailure(context, `refused with no message (${describeError(error)})`)
    }
    return { ok: false, error }
  } finally {
    clearTimeout(timer)
  }
}
