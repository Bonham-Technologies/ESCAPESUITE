import { describe, it, expect } from 'vitest'
import fixWebmDurationImport from 'webm-duration-fix'
import { fixWebMMetadata, resolveFixWebmDuration } from './converter'

/**
 * The one test file that lets the REAL `webm-duration-fix` through.
 *
 * Every other suite touching the converter does
 * `vi.mock('webm-duration-fix', () => ({ default: vi.fn() }))`, which hands the
 * module a shape of the test's own choosing — so none of them could see that
 * Vite 8's CJS interop binds the default import to the module's `exports`
 * object rather than to the function on it, and that calling it therefore threw
 * `fixWebmDuration is not a function` for every MediaRecorder take. There is
 * deliberately no `vi.mock` here.
 *
 * Two things it deliberately does not claim.
 *
 * It does not reproduce the bug. Vitest resolves the CJS default the way Vite 7
 * did — the plain `import fixWebmDuration from 'webm-duration-fix'` is a
 * function *here* — so this file is green with or without the fix. Only a
 * browser running the Vite 8 dev server or the Vite 8 build sees the broken
 * shape, which is why the red-then-green evidence lives in
 * `apps/e2e/tests/escapecraft/pip-seekable.spec.ts` and its production-layout
 * twin. What these tests pin is the resolver's contract for BOTH shapes, so
 * neither arm can be dropped as dead code by someone who only ever sees one.
 *
 * It does not run a real repair either: the library reads a WebM's EBML stream
 * and rewrites its metadata, and hand-building a container valid enough for that
 * in jsdom is not worth the fixture. The end-to-end property — a stored PiP take
 * reports a finite duration — is asserted for real in a browser by those two
 * specs.
 */
describe('webm-duration-fix interop', () => {
  describe('resolveFixWebmDuration', () => {
    it('takes the function itself when the toolchain unwrapped exports.default', () => {
      // esbuild's `__toESM(mod, 0)`: Vite 7 and earlier honoured `__esModule`
      // and bound the default import straight to the function.
      const fix = async () => new Blob()
      expect(resolveFixWebmDuration(fix)).toBe(fix)
    })

    it('reaches into .default when the toolchain handed over module.exports', () => {
      // Node's semantics, which Vite 8 adopted: the default import is the whole
      // `module.exports`, and the function sits on its `default` property.
      const fix = async () => new Blob()
      expect(resolveFixWebmDuration({ __esModule: true, default: fix })).toBe(fix)
    })
  })

  it('resolves the real module to a callable repair function', () => {
    expect(typeof resolveFixWebmDuration(fixWebmDurationImport)).toBe('function')
  })

  it('calls through into the library rather than throwing a TypeError', async () => {
    // Bytes that are not a WebM, so the library is expected to refuse them.
    // What matters is WHICH failure: reaching the EBML parser at all means the
    // import resolved, where `fixWebmDuration is not a function` — the bug this
    // file exists for — would mean it had not. jsdom's Blob has no `stream()`,
    // which the library reads the container through, so the bytes are handed
    // over as a Blob-like with one.
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
    const notAWebM = {
      type: 'video/webm',
      size: bytes.byteLength,
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
      slice: () => new Blob([bytes]),
    } as unknown as Blob

    const outcome = await fixWebMMetadata(notAWebM).then(
      () => null,
      (error: unknown) => error
    )

    expect(outcome).not.toBeNull()
    expect(String(outcome)).not.toMatch(/fixWebmDuration is not a function/)
  })
})
