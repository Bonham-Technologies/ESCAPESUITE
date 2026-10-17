/**
 * Unit tests for `utils/capturePath.ts` (ESCSUITE-320): the rig's mapping from
 * the recorder's own console line to the capture path it measured. Node 26
 * strips the types on import.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capturePathFromLine, expectedCapturePath, resolveCapturePath } from '../utils/capturePath.ts'

test('maps the three shapes the recorder logs, and nothing else', () => {
  assert.equal(capturePathFromLine('Recording audio through an AudioWorklet (blob module)'), 'worklet')
  assert.equal(capturePathFromLine('Recording audio through an AudioWorklet (data module)'), 'worklet')
  assert.equal(
    capturePathFromLine('Recording audio through a ScriptProcessorNode: this browser has no AudioWorklet'),
    'script-processor'
  )
  assert.equal(
    capturePathFromLine('Recording audio through a ScriptProcessorNode: the AudioWorklet module would not load: blob: x; data: y'),
    'script-processor'
  )
  assert.equal(capturePathFromLine('Using WebCodecs-based recorder (seekable output)'), null)
})

test('a MediaRecorder take is media-recorder whatever it logged; a WebCodecs take is its first recorder line', () => {
  assert.equal(resolveCapturePath([], 'mediarecorder'), 'media-recorder')
  assert.equal(resolveCapturePath(['Recording audio through an AudioWorklet (blob module)'], 'mediarecorder'), 'media-recorder')
  assert.equal(
    resolveCapturePath(['noise', 'Recording audio through an AudioWorklet (blob module)'], 'webcodecs'),
    'worklet'
  )
  assert.equal(
    resolveCapturePath(['Recording audio through a ScriptProcessorNode: this browser has no AudioWorklet'], 'webcodecs'),
    'script-processor'
  )
  assert.equal(resolveCapturePath(['noise'], 'webcodecs'), null)
})

test('the expected path follows the recorder and the override wins', () => {
  assert.equal(expectedCapturePath('webcodecs'), 'worklet')
  assert.equal(expectedCapturePath('mediarecorder'), 'media-recorder')
  assert.equal(expectedCapturePath('webcodecs', 'script-processor'), 'script-processor')
  assert.equal(expectedCapturePath('webcodecs', ''), 'worklet')
  assert.throws(() => expectedCapturePath('webcodecs', 'nope'), /AV_DRIFT_EXPECT_PATH/)
})
