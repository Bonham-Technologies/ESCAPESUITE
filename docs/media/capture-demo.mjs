#!/usr/bin/env node
/**
 * capture-demo.mjs — records the README hero GIF and the app screenshots.
 *
 * It drives the REAL apps (no mockups): a scripted Chromium session records a
 * short clip in ESCAPECRAFT using synthetic camera/screen media, hands it to
 * ESCAPEARTIST through the shared IndexedDB (`?loadVideo=<id>`), drops the clip
 * on the timeline, adds a text overlay and opens the export dialog.
 *
 * Because the CRAFT -> ARTIST handoff opens a real second window, Playwright
 * writes two videos; they are concatenated into one GIF by ffmpeg.
 *
 * ── How to run ────────────────────────────────────────────────────────────────
 *
 *   pnpm install
 *   pnpm build:deploy                       # -> dist/ (plan at /, craft, artist)
 *   python3 -m http.server 4173 -d dist &   # same-origin serving is REQUIRED,
 *                                           # otherwise the IndexedDB handoff
 *                                           # between CRAFT and ARTIST fails
 *   node docs/media/capture-demo.mjs
 *
 * Outputs (overwritten in place):
 *   docs/media/demo.gif
 *   docs/media/escapecraft.png
 *   docs/media/escapeartist.png
 *
 * Requirements: ffmpeg on PATH, Playwright's chromium (`pnpm --filter
 * @escapesuite/e2e exec playwright install chromium`).
 *
 * Env overrides: BASE_URL (default http://localhost:4173),
 *                KEEP_RAW=1 to keep the intermediate .webm captures,
 *                DEBUG_TIMING=1 to print per-phase timings (useful when the GIF
 *                drifts past ~20s and the beats need retuning).
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')
const mediaDir = __dirname

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173'

// Playwright lives in the e2e workspace, not at the repo root.
const require = createRequire(import.meta.url)
const playwrightEntry = require.resolve('@playwright/test', {
  paths: [join(repoRoot, 'apps', 'e2e')],
})
const playwrightNs = await import(pathToFileURL(playwrightEntry).href)
const { chromium } = playwrightNs.chromium ? playwrightNs : playwrightNs.default

const VIEWPORT = { width: 1440, height: 810 }

/** Deliberate pause — this is a demo reel, not a test suite. */
const beat = (ms) => new Promise((r) => setTimeout(r, ms))

/** Phase timing, so re-captures can be tuned against the target GIF length. */
let phaseClock = Date.now()
const phase = (label) => {
  const now = Date.now()
  if (process.env.DEBUG_TIMING) console.log(`  ${label}: ${((now - phaseClock) / 1000).toFixed(2)}s`)
  phaseClock = now
}

/**
 * Real synthetic capture devices: a live canvas-backed video track plus an
 * oscillator audio track, so the app's genuine recording pipeline produces a
 * decodable file. Adapted from apps/e2e/utils/media-mocks.ts (mockSyntheticMedia).
 */
function syntheticMediaInitScript({ width, height }) {
  const makeVideoTrack = () => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    let frame = 0
    setInterval(() => {
      frame += 1
      // Slow drifting gradient — encoders need real motion between frames.
      const hue = (frame * 0.8) % 360
      const gradient = ctx.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, `hsl(${hue}, 65%, 42%)`)
      gradient.addColorStop(1, `hsl(${(hue + 70) % 360}, 70%, 22%)`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      // Kept in the upper third so the demo's text overlay (centred) sits clear of it
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.font = `600 ${Math.round(height / 11)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('ESCAPE Suite', width / 2, height * 0.22)
    }, 33)

    return canvas.captureStream(30).getVideoTracks()[0]
  }

  const makeAudioTrack = () => {
    const audioContext = new AudioContext()
    const destination = audioContext.createMediaStreamDestination()
    const oscillator = audioContext.createOscillator()
    oscillator.frequency.value = 220
    oscillator.connect(destination)
    oscillator.start()
    return destination.stream.getAudioTracks()[0]
  }

  navigator.mediaDevices.getDisplayMedia = async (constraints) => {
    const stream = new MediaStream([makeVideoTrack()])
    if (constraints?.audio) stream.addTrack(makeAudioTrack())
    return stream
  }

  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const tracks = []
    if (constraints?.video) tracks.push(makeVideoTrack())
    if (constraints?.audio) tracks.push(makeAudioTrack())
    return new MediaStream(tracks)
  }
}

/**
 * Resolve as soon as the ESCAPEARTIST preview canvas has painted a real frame
 * (it is solid black while the decoder spins up). Falls back to a fixed wait if
 * the canvas can't be sampled.
 */
async function waitForPreviewFrame(page, timeout = 8000) {
  try {
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('canvas')
        if (!canvas || !canvas.width) return false
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const { data } = ctx.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          8,
          8
        )
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 45) return true
        }
        return false
      },
      undefined,
      { timeout, polling: 120 }
    )
  } catch {
    console.warn('  ! preview frame not detected — falling back to a fixed wait')
    await beat(2500)
  }
}

async function main() {
  const rawDir = mkdtempSync(join(tmpdir(), 'escape-demo-'))
  mkdirSync(mediaDir, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium', // full build, not headless_shell — we need real media codecs
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
    ],
  })

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    permissions: ['camera', 'microphone'],
    recordVideo: { dir: rawDir, size: VIEWPORT },
  })
  // 1080p synthetic source: matches ESCAPEARTIST's default project resolution,
  // so the imported clip fills the preview instead of sitting in pillarboxes.
  await context.addInitScript(syntheticMediaInitScript, { width: 1920, height: 1080 })

  // ── ESCAPECRAFT: record a short clip ────────────────────────────────────────
  const craftOpenedAt = Date.now()
  const craft = await context.newPage()
  await craft.goto(`${BASE_URL}/craft/`, { waitUntil: 'networkidle' })
  await craft.waitForSelector('button[aria-label="Start recording"]')
  // Playwright starts recording at page creation; remember the boot time so the
  // blank pre-paint frames can be trimmed off the front of the clip.
  const craftBootSeconds = (Date.now() - craftOpenedAt) / 1000
  phase('craft boot')
  await beat(1000) // let the reader take in the UI

  await craft.click('button[aria-label="Start recording"]')
  // 3-2-1 countdown runs first; only then does the header flip to "Recording"
  await craft.waitForSelector('button[aria-label="Pause recording"]', { timeout: 20_000 })
  phase('craft countdown')
  await beat(2200) // live preview + running timer
  await craft.click('button[aria-label="Stop recording"]')
  const stoppedAt = Date.now()

  // The saved recording lands in the sidebar list. Remuxing + thumbnailing can
  // stall on "Saving…" long enough to be worth eliding from the reel.
  const openInEditor = craft.locator('button[aria-label^="Open "][aria-label$=" in Editor"]').first()
  await openInEditor.waitFor({ timeout: 20_000 })
  const savedAt = Date.now()
  phase('craft save')
  await beat(1200)
  // Nothing after this point changes what CRAFT shows, but its video keeps
  // rolling until the ARTIST window has booted — note the cut point.
  const craftEndSeconds = (Date.now() - craftOpenedAt) / 1000 + 0.4

  await craft.screenshot({ path: join(mediaDir, 'escapecraft.png') })
  phase('craft screenshot')

  // ── Handoff: CRAFT opens ARTIST via window.open('/artist/?loadVideo=<id>') ──
  const artistOpenedAt = Date.now()
  const [artist] = await Promise.all([context.waitForEvent('page'), openInEditor.click()])
  await artist.setViewportSize(VIEWPORT)
  await artist.waitForLoadState('networkidle')
  const artistBootSeconds = (Date.now() - artistOpenedAt) / 1000
  phase('artist boot')

  // Stop CRAFT's video here so the two clips cut cleanly instead of overlapping.
  const craftVideo = craft.video()
  await craft.close()
  const craftVideoPath = await craftVideo.path()

  // ── ESCAPEARTIST: timeline, text overlay, export ────────────────────────────
  await artist.bringToFront()
  await beat(900) // "Loaded recording: ..." toast

  await artist.locator('button[title="Add to timeline"]').first().click()
  await beat(500)

  // Play a moment of the clip. Besides showing off playback, this is what pumps
  // the decoder — the preview canvas stays black until a frame is drawn into it.
  await artist.locator('button[title="Play (Space)"]').click()
  await waitForPreviewFrame(artist, 6000)
  phase('artist first frame')
  await beat(900)
  const pauseButton = artist.locator('button[title="Pause (Space)"]')
  if (await pauseButton.count()) await pauseButton.click()
  await beat(500)

  // Zoom the timeline so the clips read at GIF scale
  const zoomIn = artist.locator('button[aria-label="Zoom in timeline"]')
  await zoomIn.click()
  await beat(250)
  await zoomIn.click()
  await beat(650)

  await artist.getByRole('button', { name: 'Add Text' }).click()
  await beat(700)

  const textArea = artist.locator('textarea[placeholder="Enter text..."]')
  await textArea.waitFor()
  await textArea.fill('')
  await textArea.pressSequentially('100% local. No uploads.', { delay: 45 })
  await beat(1100)

  await artist.screenshot({ path: join(mediaDir, 'escapeartist.png') })
  phase('artist screenshot')

  await artist.click('button[aria-label="Export video"]')
  await artist.waitForSelector('text=Export Video')
  phase('artist export dialog')
  await beat(700)
  await artist.getByRole('button', { name: 'Advanced options' }).click()
  await beat(1600) // hold on the export options — the closing frame

  const artistVideo = artist.video()
  await artist.close()
  const artistVideoPath = await artistVideo.path()

  await context.close()
  await browser.close()

  // ── webm x2 -> one palette-optimised GIF ────────────────────────────────────
  const gifPath = join(mediaDir, 'demo.gif')
  const FPS = 12
  const WIDTH = 900
  // Segments to keep, in order. Each page's video starts at page creation, so
  // the boot frames (blank while the SPA mounts) and the tail that runs on after
  // the last on-screen action get trimmed away, as does CRAFT's "Saving…" gap.
  const rel = (t) => (t - craftOpenedAt) / 1000
  const saveGap = { from: rel(stoppedAt) + 0.6, to: rel(savedAt) - 0.15 }
  const elideSave = saveGap.to - saveGap.from > 0.5

  const segments = elideSave
    ? [
        { input: 0, start: Math.max(0, craftBootSeconds - 0.35), end: saveGap.from },
        { input: 0, start: saveGap.to, end: craftEndSeconds },
        { input: 1, start: Math.max(0, artistBootSeconds - 0.35) },
      ]
    : [
        { input: 0, start: Math.max(0, craftBootSeconds - 0.35), end: craftEndSeconds },
        { input: 1, start: Math.max(0, artistBootSeconds - 0.35) },
      ]

  const chains = segments.map(
    ({ input, start, end }, n) =>
      `[${input}:v]trim=start=${start.toFixed(2)}` +
      `${end === undefined ? '' : `:end=${end.toFixed(2)}`},setpts=PTS-STARTPTS,` +
      `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,setsar=1[s${n}]`
  )
  const filter =
    `${chains.join(';')};` +
    `${segments.map((_, n) => `[s${n}]`).join('')}concat=n=${segments.length}:v=1:a=0[c];` +
    `[c]split[p0][p1];[p0]palettegen=max_colors=192:stats_mode=diff[p];` +
    `[p1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`

  console.log(
    `stitching ${segments.length} segments${elideSave ? " (CRAFT's save gap elided)" : ''}: ` +
      segments
        .map((s) => `#${s.input} ${s.start.toFixed(2)}→${s.end?.toFixed(2) ?? 'end'}`)
        .join(', ')
  )
  execFileSync(
    'ffmpeg',
    ['-y', '-i', craftVideoPath, '-i', artistVideoPath, '-filter_complex', filter,
     '-loop', '0', gifPath],
    { stdio: 'inherit' }
  )

  if (process.env.KEEP_RAW) {
    copyFileSync(craftVideoPath, join(mediaDir, 'raw-craft.webm'))
    copyFileSync(artistVideoPath, join(mediaDir, 'raw-artist.webm'))
  }
  rmSync(rawDir, { recursive: true, force: true })

  for (const f of ['demo.gif', 'escapecraft.png', 'escapeartist.png']) {
    const p = join(mediaDir, f)
    if (!existsSync(p)) throw new Error(`missing output: ${p}`)
    const size = `${(statSync(p).size / 1024 / 1024).toFixed(2)} MB`
    const seconds = f.endsWith('.gif')
      ? ` ${Number(
          execFileSync('ffprobe', [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p,
          ]).toString()
        ).toFixed(1)}s`
      : ''
    console.log(`${f}  ${size}${seconds}`)
  }
}

await main()
