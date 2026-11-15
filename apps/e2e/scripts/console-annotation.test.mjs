/**
 * Unit tests for `utils/consoleAnnotation.ts` (ESCSUITE-450): a console line
 * containing the watched text becomes a test annotation, and nothing else does.
 * Node strips the types on import.
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { watchConsoleForAnnotation } from '../utils/consoleAnnotation.ts'

/** Just enough of a Playwright Page: `on`/`off` and console messages with `text()`. */
function fakePage() {
  const emitter = new EventEmitter()
  return {
    on: (event, handler) => emitter.on(event, handler),
    off: (event, handler) => emitter.off(event, handler),
    log: (text) => emitter.emit('console', { text: () => text }),
    listeners: () => emitter.listenerCount('console'),
  }
}

test('annotates each matching console line with its full text, and ignores the rest', () => {
  const page = fakePage()
  const testInfo = { annotations: [{ type: 'existing', description: 'kept' }] }
  watchConsoleForAnnotation(page, testInfo, { contains: 'stopped completing seeks', type: 'reload-fired' })

  page.log('Export: starting')
  page.log('Export: "a.webm" stopped completing seeks; reloaded it from a fresh copy')
  page.log('Export: "b.webm" stopped completing seeks; reloaded it from a repaired copy')

  assert.deepEqual(testInfo.annotations, [
    { type: 'existing', description: 'kept' },
    { type: 'reload-fired', description: 'Export: "a.webm" stopped completing seeks; reloaded it from a fresh copy' },
    { type: 'reload-fired', description: 'Export: "b.webm" stopped completing seeks; reloaded it from a repaired copy' },
  ])
})

test('adds nothing when no line matches', () => {
  const page = fakePage()
  const testInfo = { annotations: [] }
  watchConsoleForAnnotation(page, testInfo, { contains: 'stopped completing seeks', type: 'reload-fired' })
  page.log('Export finished')
  assert.deepEqual(testInfo.annotations, [])
})

test('the returned function stops watching', () => {
  const page = fakePage()
  const testInfo = { annotations: [] }
  const stop = watchConsoleForAnnotation(page, testInfo, { contains: 'x', type: 't' })
  assert.equal(page.listeners(), 1)
  stop()
  assert.equal(page.listeners(), 0)
  page.log('x')
  assert.deepEqual(testInfo.annotations, [])
})

test("journey 01's watched text still matches ARTIST's reload warning", async () => {
  // If ARTIST rewords the warning, journey 01 would silently stop annotating
  // reloads and every count would read as "never fired". Keep the two in step.
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../../artist/src/core/elementFrames.ts', import.meta.url), 'utf8')
  const journey = await readFile(new URL('../tests/journeys/01-record-edit-export.spec.ts', import.meta.url), 'utf8')
  const watched = journey.match(/contains:\s*'([^']+)'/)?.[1]
  assert.equal(watched, 'stopped completing seeks')
  assert.match(source, /console\.warn\(`Export: "\$\{name\}" stopped completing seeks; reloaded it from/)
})
