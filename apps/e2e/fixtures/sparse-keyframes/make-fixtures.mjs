#!/usr/bin/env node
// Regenerates the ESCSUITE-359 sparse-key-frame fixtures. Needs `ffmpeg` on PATH
// and `pnpm install` run (mediabunny is resolved from apps/artist).
//   node make-fixtures.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, 'long-sparse.webm')
const reindexed = resolve(here, 'long-sparse-reindexed-before-359.webm')

// 60 s of testsrc2 (every frame differs) and a tone, one key frame at 0 s, no
// Cues: what a MediaRecorder take looks like to the import re-index.
const args = [
  '-y', '-v', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=15:duration=60',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
  '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '24k', '-g', '100000', '-auto-alt-ref', '0',
  '-c:a', 'libopus', '-b:a', '12k',
  '-live', '1', '-f', 'webm', source,
]
console.log(['ffmpeg', ...args].join(' '))
execFileSync('ffmpeg', args, { stdio: 'inherit' })

// The same packets copied through Mediabunny's muxer exactly as the
// ESCSUITE-305 re-index did before ESCSUITE-359: a forced Cluster at 32.767 s
// that starts on a delta frame, with a video cue on it.
const require = createRequire(resolve(here, '../../../artist/package.json'))
const {
  BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Output, WEBM,
  WebMOutputFormat,
} = await import(pathToFileURL(require.resolve('mediabunny')).href).then((m) => m.default ?? m)

const input = new Input({ source: new BlobSource(new Blob([readFileSync(source)])), formats: [WEBM] })
const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
const pumps = []
for (const track of await input.getTracks()) {
  const isVideo = track.isVideoTrack()
  const packetSource = isVideo ? new EncodedVideoPacketSource(track.codec) : new EncodedAudioPacketSource(track.codec)
  if (isVideo) output.addVideoTrack(packetSource)
  else output.addAudioTrack(packetSource)
  const meta = { decoderConfig: await track.getDecoderConfig() }
  pumps.push(async () => {
    for await (const packet of new EncodedPacketSink(track).packets()) await packetSource.add(packet, meta)
    packetSource.close()
  })
}
await output.start()
await Promise.all(pumps.map((pump) => pump()))
await output.finalize()
writeFileSync(reindexed, new Uint8Array(output.target.buffer))
console.log(`wrote ${reindexed}`)
