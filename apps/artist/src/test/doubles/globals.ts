// Temporarily take a global away, the way a browser without that API looks.
//
// Capability probes in the code under test branch on `typeof X === 'undefined'`,
// and jsdom (plus src/test/setup.ts) defines several of those globals, so the
// unsupported branch is otherwise unreachable. Returns a function that puts the
// global back exactly as it was — including leaving it absent if it never
// existed.
const MISSING = Symbol('missing')

export function removeGlobal(name: string): () => void {
  const g = globalThis as unknown as Record<string, unknown>
  const previous = name in g ? g[name] : MISSING
  delete g[name]
  return () => {
    if (previous === MISSING) delete g[name]
    else g[name] = previous
  }
}
