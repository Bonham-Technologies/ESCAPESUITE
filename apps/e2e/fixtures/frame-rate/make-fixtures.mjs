#!/usr/bin/env node
// Generates the high-frame-rate fixtures for a real-browser check of
// ESCAPEARTIST's import-time frame-rate probe (ESCSUITE-276, review round 2):
// `requestVideoFrameCallback` fires at most once per rendered frame, so a
// 120 fps file played at 1x on a 60 Hz display reads as 60. The probe plays at
// half speed; these files are what a browser test imports to see it read 120.
//
// Needs ffmpeg with libx264 and libvpx-vp9 on PATH. Not run by any test or CI
// job; run it by hand and commit what it writes:
//
//   node apps/e2e/fixtures/frame-rate/make-fixtures.mjs
//
// Writes, next to this script:
//   120fps.mp4   1 s, 120 fps, 160x120 H.264 — exact 1/120 s timestamps
//   120fps.webm  1 s, 120 fps, 160x120 VP9 — whole-millisecond timestamps,
//                the case the span estimator exists for
//   24fps.webm   1 s, 24 fps, 160x120 VP9 — the slowest common rate, which
//                must still yield enough frames inside the 500 ms budget
//
// Each frame's picture is different (a moving bar), so no encoder can collapse
// frames into one and change the presented rate.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** A 160x120 source at `fps` whose white bar moves one step per frame. */
const source = (fps) =>
  `color=c=black:s=160x120:r=${fps}:d=1,drawbox=x='mod(n*4,160)':y=0:w=4:h=120:c=white:t=fill`

const fixtures = [
  { name: '120fps.mp4', fps: 120, codec: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'] },
  { name: '120fps.webm', fps: 120, codec: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p'] },
  { name: '24fps.webm', fps: 24, codec: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p'] },
]

for (const { name, fps, codec } of fixtures) {
  execFileSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', source(fps), '-r', String(fps), ...codec, '-an', join(here, name)],
    { stdio: 'inherit' }
  )
  console.log(`wrote ${name}`)
}
