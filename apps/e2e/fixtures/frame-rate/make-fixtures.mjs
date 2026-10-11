#!/usr/bin/env node
// Regenerates the ESCSUITE-277 frame-rate fixtures. Needs `ffmpeg` on PATH.
//   node make-fixtures.mjs
// Each file is 2 s of ffmpeg's `testsrc` at 160x120 (moving counter, so frames differ).
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** [file, -r value, codec args] */
const fixtures = [
  ...[
    ['24', '24'],
    ['30', '30'],
    ['60', '60'],
    ['120', '120'],
    ['29.97', '30000/1001'],
  ].map(([name, rate]) => [`testsrc-${name}fps.mp4`, rate, ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30']]),
  ...['24', '30', '60', '120'].map((rate) => [
    `testsrc-${rate}fps.webm`,
    rate,
    ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '40', '-b:v', '0'],
  ]),
]

for (const [file, rate, codec] of fixtures) {
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=s=160x120:r=${rate}:d=2`, '-r', rate, ...codec, '-an', resolve(here, file)]
  console.log(['ffmpeg', ...args].join(' '))
  execFileSync('ffmpeg', args, { stdio: 'inherit' })
}
