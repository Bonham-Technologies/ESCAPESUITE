import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Test-only ffmpeg/ffprobe helpers. Nothing here ships: `dist/cli.js` is bundled from
 * `src/cli.ts`'s import graph, which never reaches this file, and the kit's `files` list
 * excludes `test/` entirely.
 *
 * Every call goes through `execFile` with an argv array — never a shell — so a file path
 * containing a space, a quote or a `;` is an argument, not syntax.
 */

const execFileAsync = promisify(execFile)

/** Only the fields `probe` asks ffprobe for. Absent fields are absent for audio streams too. */
export interface ProbeStream {
  codec_type: string
  codec_name: string
  width?: number
  height?: number
  /** ffprobe reports counted frames as a decimal string, not a number. */
  nb_read_frames?: string
}

export interface ProbeResult {
  streams: ProbeStream[]
  /** `duration` is a decimal string, and is missing for containers that do not declare one. */
  format: { duration?: string }
}

let available: boolean | undefined

/**
 * True when both binaries are on PATH. Cached: the suite asks once per test file, and a
 * `-version` spawn per ask is pure overhead. `-version` (rather than `which`) is what proves
 * the binary is actually executable here.
 */
export function hasFfmpeg(): boolean {
  if (available === undefined) {
    try {
      execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
      available = true
    } catch {
      available = false
    }
  }
  return available
}

/**
 * Stream and container facts about a media file. `-count_frames` decodes the whole file to
 * count frames exactly, which is affordable only because the fixtures are 64x48 and ~1 s.
 */
export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-count_frames',
    '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames:format=duration',
    '-of', 'json',
    file,
  ])
  return JSON.parse(stdout) as ProbeResult
}

/**
 * The mean colour of one frame, as `[r, g, b]` in 0-255. `scale=1:1` makes ffmpeg do the
 * averaging: the frame is downscaled to a single pixel, then emitted as three raw rgb24
 * bytes. Frames are zero-indexed, matching `select=eq(n,...)`.
 */
export async function frameMeanRGB(file: string, frameIndex: number): Promise<[number, number, number]> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', file,
      // The comma inside eq() is escaped so the filter parser reads it as an argument
      // separator rather than the end of the `select` filter.
      '-vf', `select=eq(n\\,${frameIndex}),scale=1:1`,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ],
    { encoding: 'buffer' },
  )

  if (stdout.length < 3) {
    throw new Error(`frame ${frameIndex} of "${file}" produced ${stdout.length} bytes, expected 3`)
  }
  return [stdout[0], stdout[1], stdout[2]]
}
