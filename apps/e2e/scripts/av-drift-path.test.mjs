/** Unit tests for `av-drift-path.mjs` (ESCSUITE-320): the report's capture-path branch. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWorkletTake, lostCallbacksCell, WORKLET_CALLBACKS_CELL, WORKLET_H1A_VERDICT } from './av-drift-path.mjs'

test('a worklet take reads n/a and says why', () => {
  const m = { capturePath: 'worklet', nodes: [], lostCallbacks: 0 }
  assert.equal(isWorkletTake(m), true)
  assert.equal(lostCallbacksCell(m, '**0** (no ScriptProcessor — MediaRecorder path)'), 'n/a (AudioWorklet)')
  assert.equal(WORKLET_CALLBACKS_CELL, 'n/a (AudioWorklet)')
  assert.match(WORKLET_H1A_VERDICT, /n\/a — the worklet carries the audio; no ScriptProcessor callbacks to count/)
})

test('script-processor, media-recorder and pre-320 measurements keep their reading', () => {
  for (const capturePath of ['script-processor', 'media-recorder', undefined]) {
    const m = { capturePath, nodes: [], lostCallbacks: 0 }
    assert.equal(isWorkletTake(m), false)
    assert.equal(lostCallbacksCell(m, 'legacy'), 'legacy')
  }
})
