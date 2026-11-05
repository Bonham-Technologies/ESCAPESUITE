#!/usr/bin/env node
// Regenerates the ESCSUITE-395 fixture. Needs `ffmpeg` (with libopus) on PATH.
//   node make-fixture.mjs
//
// ffmpeg encodes the Opus packets; this script lays them out the way a
// MediaRecorder microphone take is laid out (unknown-size Segment and
// Clusters, no Duration, no Cues, no SeekHead), with a Cluster every second
// and a final Cluster that holds a single block.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, 'mic-take-last-cluster-one-block.webm')

/** 151 Opus packets of 20 ms: blocks at 0, 20, ... 3000 ms. */
const PACKETS = 151
const FRAME_MS = 20
const CLUSTER_MS = 1000

const scratch = mkdtempSync(join(tmpdir(), 'escsuite-395-'))
const encoded = join(scratch, 'tone.webm')
try {
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3.1',
    '-c:a', 'libopus', '-b:a', '24k', '-ac', '1', '-frame_duration', String(FRAME_MS),
    '-fflags', '+bitexact', '-f', 'webm', encoded,
  ], { stdio: 'inherit' })
  writeFileSync(out, mux(readOpus(readFileSync(encoded))))
  console.log(`wrote ${out}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

// --- reading ffmpeg's file: CodecPrivate and every frame, in order ----------

function readOpus(bytes) {
  const MASTER = new Set([0x18538067, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0])
  const frames = []
  let codecPrivate
  const walk = (start, end) => {
    for (let i = start; i < end; ) {
      const { id, dataStart, size } = readHeader(bytes, i)
      const stop = size === undefined ? end : dataStart + size
      if (id === 0x63a2) codecPrivate = bytes.subarray(dataStart, stop)
      // SimpleBlock or Block: 1-byte track vint, int16 timecode, flags, frame.
      if (id === 0xa3 || id === 0xa1) frames.push(bytes.subarray(dataStart + 4, stop))
      if (MASTER.has(id)) walk(dataStart, stop)
      i = stop
    }
  }
  walk(0, bytes.length)
  if (!codecPrivate || frames.length < PACKETS) throw new Error(`ffmpeg gave ${frames.length} frames`)
  return { codecPrivate, frames: frames.slice(0, PACKETS) }
}

function readHeader(bytes, at) {
  const len = (b) => Math.clz32(b) - 23
  const idLength = len(bytes[at])
  let id = 0
  for (let k = 0; k < idLength; k++) id = id * 256 + bytes[at + k]
  const sizeLength = len(bytes[at + idLength])
  const mask = 0xff >> sizeLength
  let size = bytes[at + idLength] & mask
  let unknown = size === mask
  for (let k = 1; k < sizeLength; k++) {
    size = size * 256 + bytes[at + idLength + k]
    unknown = unknown && bytes[at + idLength + k] === 0xff
  }
  return { id, dataStart: at + idLength + sizeLength, size: unknown ? undefined : size }
}

// --- writing the MediaRecorder-shaped take ----------------------------------

function mux({ codecPrivate, frames }) {
  const clusters = []
  for (let start = 0; start < frames.length * FRAME_MS; start += CLUSTER_MS) {
    const blocks = []
    for (let n = start / FRAME_MS; n < frames.length && n * FRAME_MS < start + CLUSTER_MS; n++) {
      const rel = n * FRAME_MS - start
      blocks.push(el(0xa3, concat([u8(0x81, rel >> 8, rel & 0xff, 0x80), frames[n]])))
    }
    clusters.push(unknownSize(0x1f43b675, concat([el(0xe7, uint(start)), ...blocks])))
  }
  const ebml = el(0x1a45dfa3, concat([
    el(0x4286, uint(1)), el(0x42f7, uint(1)), el(0x42f2, uint(4)), el(0x42f3, uint(8)),
    el(0x4282, text('webm')), el(0x4287, uint(4)), el(0x4285, uint(2)),
  ]))
  const info = el(0x1549a966, concat([
    el(0x2ad7b1, uint(1_000_000)), el(0x4d80, text('ESCSUITE-395 fixture')), el(0x5741, text('ESCSUITE-395 fixture')),
  ]))
  const tracks = el(0x1654ae6b, el(0xae, concat([
    el(0xd7, uint(1)), el(0x73c5, uint(1)), el(0x83, uint(2)), el(0x86, text('A_OPUS')),
    el(0x63a2, codecPrivate), el(0xe1, concat([el(0xb5, float64(48000)), el(0x9f, uint(1))])),
  ])))
  return concat([ebml, unknownSize(0x18538067, concat([info, tracks, ...clusters]))])
}

function u8(...values) { return Uint8Array.from(values) }
function text(s) { return new TextEncoder().encode(s) }
function uint(v) {
  const out = []
  do { out.unshift(v & 0xff); v = Math.floor(v / 256) } while (v > 0)
  return Uint8Array.from(out)
}
function float64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return b }
function id(v) { return uint(v) }
/** An element with its size in the shortest vint that holds it, as the browsers write them. */
function el(elementId, payload) {
  let length = 1
  while (payload.length >= 2 ** (7 * length) - 1) length++
  const size = new Uint8Array(length)
  let v = payload.length
  for (let k = length - 1; k >= 0; k--) { size[k] = v & 0xff; v = Math.floor(v / 256) }
  size[0] |= 0x80 >> (length - 1)
  return concat([id(elementId), size, payload])
}
/** An element written with the reserved unknown size, as MediaRecorder writes the Segment and each Cluster. */
function unknownSize(elementId, payload) {
  return concat([id(elementId), u8(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), payload])
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
