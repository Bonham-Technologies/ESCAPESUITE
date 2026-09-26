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
 * The colour of one frame at a point near its centre, as `[r, g, b]` in 0-255.
 *
 * **Not a mean, despite the name.** `scale=1:1` does not average the source: measured against
 * ffmpeg here, a scale to one pixel reads a single near-centre sample of its input (on a 2 px
 * input, literally the bottom-right pixel). The fixtures are flat colour fields, so the answer
 * is the fixture's colour either way and every assertion that reads this is sound — but a caller
 * who needs a true mean must chain halving steps (`scale=iw/2:ih/2` until 1x1) or tile the
 * pixels and average them, not ask for 1x1 in one hop. The name is kept because every call site
 * uses it, and the correction is here rather than in a rename.
 *
 * Emitted as three raw rgb24 bytes. Frames are zero-indexed, matching `select=eq(n,...)`.
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

/**
 * The colour of one frame inside the rectangle `(x, y, width, height)`, as
 * `[r, g, b]` in 0-255.
 *
 * {@link frameMeanRGB} reads near the centre of the *whole* frame, which is the
 * right probe for "is this clip still red after the round trip" and the wrong
 * one for anything local — the centre of a circle-masked frame is red whether or
 * not the corners were cut away. This crops first, so the caller chooses **where**
 * is read.
 *
 * **`scale=1:1` samples, it does not average.** Measured: scaling to one pixel in
 * one hop reads a near-centre pixel of the crop (on a 2 px crop, the bottom-right
 * one), so what comes back is the colour at roughly the middle of the rectangle
 * asked for, not the rectangle's mean. Every caller here is sound because its
 * crop is **sized so the pixels around its centre are all one colour** — that is
 * what makes the answer independent of which near-centre pixel the scaler
 * happens to take, and it is a property of the call sites rather than of this
 * function. A caller that genuinely needs the mean of a mixed rectangle must
 * chain halving steps (`scale=iw/2:ih/2` down to 1x1) or `tile` the pixels and
 * average them; a single `scale=1:1` will quietly answer with one pixel.
 *
 * `format=rgb24` comes **before** the crop deliberately. On a subsampled
 * yuv420p stream ffmpeg snaps an odd crop offset onto the chroma grid and
 * silently measures a different rectangle; converting first makes every offset
 * exact. Frames are zero-indexed, matching `select=eq(n,...)`.
 *
 * **One ffmpeg process per sample.** At the fixtures' 64x48 that is a few
 * milliseconds and invisible beside the Chromium launch the render itself needs,
 * so three samples of one frame are spelled as three calls. A case that wants
 * dozens of points should not loop over this: one pass with several `crop`
 * outputs (or a `tile` of them) reads them all from a single decode.
 */
export async function frameRegionRGB(
  file: string,
  frameIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<[number, number, number]> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', file,
      // The comma inside eq() is escaped so the filter parser reads it as an
      // argument separator rather than the end of the `select` filter.
      '-vf', `select=eq(n\\,${frameIndex}),format=rgb24,crop=${width}:${height}:${x}:${y},scale=1:1`,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ],
    { encoding: 'buffer' },
  )

  if (stdout.length < 3) {
    throw new Error(
      `frame ${frameIndex} of "${file}" at ${width}x${height}+${x}+${y} produced ${stdout.length} bytes, expected 3`,
    )
  }
  return [stdout[0], stdout[1], stdout[2]]
}

/**
 * The colour inside the frame's top-left `size` x `size` block — the corner a
 * mask cuts away.
 *
 * Filter: `select=eq(n\,N),format=rgb24,crop=8:8:0:0,scale=1:1`, which reads a
 * near-centre pixel of that block rather than its mean (see
 * {@link frameRegionRGB}). 8 px because it is big enough that the pixel read is
 * clear of an encoder's ringing at a distant edge and small enough to stay well
 * clear of a circle inscribed in the frame — on a 64x48 frame the nearest point
 * of this block to that circle's centre is 30 px away against a radius of 24, so
 * every pixel of it is background on a masked frame, which is what makes one
 * sample of it as good as the mean.
 */
export async function frameCornerRGB(
  file: string,
  frameIndex: number,
  size = 8,
): Promise<[number, number, number]> {
  return frameRegionRGB(file, frameIndex, 0, 0, size, size)
}

/**
 * The colour at `(x, y)` — a point on a mask's outline, which is where a stroke
 * either is or is not.
 *
 * Filter, for the default size centred on (8, 24):
 * `select=eq(n\,N),format=rgb24,crop=4:4:6:22,scale=1:1`. That `scale=1:1` reads
 * a near-centre pixel of the crop rather than its mean (see
 * {@link frameRegionRGB}), and the crop is centred on `(x, y)`, so what comes
 * back is the colour **at** the point asked for. Small, because a stroke is a
 * band a few pixels wide: the block has to be narrow enough that its middle is
 * inside the band, and narrow enough that a caller reasoning about it can say
 * every pixel of it is one colour. The caller picks a point at least `size / 2`
 * from the frame's edges: an outline that touches the edge has half its line
 * outside the frame, which is not a thing to measure.
 *
 * That last sentence is enforced rather than assumed, but **only on two of the
 * four edges**. Clamping a sample back inside the frame would measure an
 * off-centre rectangle and return it as the colour *at* the point asked for —
 * precisely the silent mismeasurement this whole family of samplers exists to
 * rule out — so a point too close to the **top or left** edge throws here.
 * Past the right or bottom edge it cannot: this function is handed no frame
 * size, and ffmpeg is the first thing in the chain that knows one. A crop that
 * runs off those edges fails inside ffmpeg instead, and reaches the caller as
 * `frameRegionRGB`'s "produced 0 bytes" — a loud failure naming the rectangle,
 * which is why there is no half-guard here pretending to cover all four.
 */
export async function frameEdgeRGB(
  file: string,
  frameIndex: number,
  x: number,
  y: number,
  size = 4,
): Promise<[number, number, number]> {
  const left = Math.round(x - size / 2)
  const top = Math.round(y - size / 2)
  if (left < 0 || top < 0) {
    throw new Error(
      `frameEdgeRGB: a ${size}x${size} sample centred on (${x}, ${y}) would start at ` +
        `(${left}, ${top}), outside the frame — centre it at least ${size / 2} px from every edge`,
    )
  }
  return frameRegionRGB(file, frameIndex, left, top, size, size)
}
