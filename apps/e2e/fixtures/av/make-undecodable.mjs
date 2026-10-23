#!/usr/bin/env node
// Regenerates undecodable-opus.webm (ESCSUITE-365): an audio file whose
// container is sound but whose audio does not decode. Run from this directory:
//   node make-undecodable.mjs
// Needs ffmpeg with libopus.
//
// The WebM is a real 2 s Opus tone, so the browser reads its header and its
// Duration: an `<audio>` element reports `loadedmetadata` with a 2 s length
// and ARTIST imports it. Then every frame's payload is overwritten with 0xFF.
// An Opus packet that starts 0xFF 0xFF declares 63 frames of 20 ms, past the
// 120 ms a packet may hold, so every packet is invalid: the streamed waveform
// decode (WebCodecs `AudioDecoder`) errors, and so does the whole-file
// `decodeAudioData` fallback (`apps/artist/src/utils/waveform.ts`).
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const SOURCE = 'undecodable-source.tmp.webm'
const OUT = 'undecodable-opus.webm'

execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*440*t)':s=48000:d=2",
  '-c:a', 'libopus', '-b:a', '32k', '-ac', '1',
  '-f', 'webm', SOURCE,
])
const bytes = readFileSync(SOURCE)
rmSync(SOURCE)

/** An EBML variable-length integer at `at`: its length and value. */
function vint(at, keepMarker) {
  const first = bytes[at]
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  let value = keepMarker ? first : first & (0xff >> length)
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i]
  return { length, value }
}

// Master elements to descend into: Segment, Cluster, BlockGroup.
const MASTERS = new Set([0x18538067, 0x1f43b675, 0xa0])
const SIMPLE_BLOCK = 0xa3
const BLOCK = 0xa1

let blocks = 0
function walk(start, end) {
  let at = start
  while (at < end) {
    const id = vint(at, true)
    const size = vint(at + id.length, false)
    const body = at + id.length + size.length
    // An unknown size (all ones) runs to the parent's end.
    const unknown = size.value === 2 ** (7 * size.length) - 1
    const bodyEnd = unknown ? end : body + size.value
    if (MASTERS.has(id.value)) {
      walk(body, bodyEnd)
    } else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
      // Track number (a vint), a 16-bit timecode, a flags byte, then the frame.
      const track = vint(body, false)
      const flags = bytes[body + track.length + 2]
      if (flags & 0x06) throw new Error('laced block: not written by ffmpeg for Opus, not handled')
      bytes.fill(0xff, body + track.length + 3, bodyEnd)
      blocks++
    }
    at = bodyEnd
  }
}
walk(0, bytes.length)
if (blocks === 0) throw new Error('no blocks found')
writeFileSync(OUT, bytes)
console.log(`${OUT}: ${blocks} Opus packets overwritten`)
