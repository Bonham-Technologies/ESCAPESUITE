#!/usr/bin/env node
/**
 * capture.mjs: the Product Hunt gallery shots and thumbnail (ESCSUITE-527).
 *
 * Drives the REAL hosted apps (no mockups), like docs/media/capture-demo.mjs:
 * synthetic camera/screen media is recorded in ESCAPECRAFT, handed to
 * ESCAPEARTIST and put on the timeline with a text overlay, and the hub's
 * offline section is shot. The synthetic source is a drifting gradient, so no
 * shot holds personal data.
 *
 *   node docs/launch/product-hunt/capture.mjs
 *
 * Env: BASE_URL (default https://escapesuite.tech, the canonical host).
 * Outputs, overwritten in place, at the gallery size (1270x760):
 *   1-hub.png, 2-craft-recording.png, 3-artist-editing.png, 4-why-offline.png
 * and thumbnail.png (240x240, the suite's mark).
 *
 * Requirements: Playwright's chromium (`pnpm --filter @escapesuite/e2e exec
 * playwright install chromium`). Re-run on launch week so the shots match the
 * live app.
 */

import { createRequire } from 'node:module'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')
const outDir = __dirname

const BASE_URL = (process.env.BASE_URL ?? 'https://escapesuite.tech').replace(/\/$/, '')

const require = createRequire(import.meta.url)
const playwrightEntry = require.resolve('@playwright/test', {
  paths: [join(repoRoot, 'apps', 'e2e')],
})
const playwrightNs = await import(pathToFileURL(playwrightEntry).href)
const { chromium } = playwrightNs.chromium ? playwrightNs : playwrightNs.default

/** Product Hunt's recommended gallery image size. */
const VIEWPORT = { width: 1270, height: 760 }

const beat = (ms) => new Promise((r) => setTimeout(r, ms))

/** Synthetic capture devices, as in docs/media/capture-demo.mjs. */
function syntheticMediaInitScript({ width, height }) {
  const makeVideoTrack = () => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    let frame = 0
    setInterval(() => {
      frame += 1
      const hue = (frame * 0.8) % 360
      const gradient = ctx.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, `hsl(${hue}, 65%, 42%)`)
      gradient.addColorStop(1, `hsl(${(hue + 70) % 360}, 70%, 22%)`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
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

/** Wait until the ARTIST preview canvas shows a real frame (it starts black). */
async function waitForPreviewFrame(page, timeout = 8000) {
  try {
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('canvas')
        if (!canvas || !canvas.width) return false
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const { data } = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 8, 8)
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 45) return true
        }
        return false
      },
      undefined,
      { timeout, polling: 120 }
    )
  } catch {
    console.warn('  ! preview frame not detected; falling back to a fixed wait')
    await beat(2500)
  }
}

/** The suite's mark (the hub's favicon) at 240x240. */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="240" height="240">
<rect width="32" height="32" fill="#f3f0e8"/>
<path d="M3 10V3h7M22 3h7v7M29 22v7h-7M10 29H3v-7" fill="none" stroke="#0f6b70" stroke-width="3"/>
<rect x="10" y="10" width="12" height="12" fill="#0f6b70"/></svg>`

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium', // full build: real media codecs
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
  })
  await context.addInitScript(syntheticMediaInitScript, { width: 1920, height: 1080 })

  // Thumbnail
  const thumb = await context.newPage()
  await thumb.setViewportSize({ width: 240, height: 240 })
  await thumb.setContent(`<html><body style="margin:0">${MARK_SVG}</body></html>`)
  await thumb.screenshot({ path: join(outDir, 'thumbnail.png'), clip: { x: 0, y: 0, width: 240, height: 240 } })
  await thumb.close()

  // 1. The hub
  const hub = await context.newPage()
  await hub.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await beat(800)
  await hub.screenshot({ path: join(outDir, '1-hub.png') })
  await hub.close()

  // 2. ESCAPECRAFT mid-recording
  const craft = await context.newPage()
  await craft.goto(`${BASE_URL}/craft/`, { waitUntil: 'networkidle' })
  await craft.waitForSelector('button[aria-label="Start recording"]')
  await beat(800)
  await craft.click('button[aria-label="Start recording"]')
  await craft.waitForSelector('button[aria-label="Pause recording"]', { timeout: 20_000 })
  await beat(2500)
  await craft.screenshot({ path: join(outDir, '2-craft-recording.png') })
  await beat(700)
  await craft.click('button[aria-label="Stop recording"]')
  const openInEditor = craft.locator('button[aria-label^="Open "][aria-label$=" in Editor"]').first()
  await openInEditor.waitFor({ timeout: 30_000 })
  await beat(900)

  // 3. ESCAPEARTIST with the clip and a text overlay
  const [artist] = await Promise.all([context.waitForEvent('page'), openInEditor.click()])
  await artist.setViewportSize(VIEWPORT)
  await artist.waitForLoadState('networkidle')
  await craft.close()
  await beat(1500)
  // The handoff may already have put the recording on the timeline; add it only if not.
  const status = (await artist.locator('text=/\\d+ clips? · \\d+ tracks?/').first().textContent().catch(() => '')) ?? ''
  if (!/[1-9]\d* clips?/.test(status)) {
    await artist.locator('button[title="Add to timeline"]').first().click()
    await beat(500)
  }
  await artist.locator('button[title="Play (Space)"]').click()
  await waitForPreviewFrame(artist, 8000)
  await beat(900)
  const pauseButton = artist.locator('button[title="Pause (Space)"]')
  if (await pauseButton.count()) await pauseButton.click()
  await beat(500)
  const zoomIn = artist.locator('button[aria-label="Zoom in timeline"]')
  await zoomIn.click()
  await zoomIn.click()
  await beat(600)
  await artist.getByRole('button', { name: 'Add Text' }).click()
  const textArea = artist.locator('textarea[placeholder="Enter text..."]')
  await textArea.waitFor()
  await textArea.fill('100% local. No uploads.')
  await beat(1200) // let any toast clear
  await artist.screenshot({ path: join(outDir, '3-artist-editing.png') })

  // 4. Why it runs offline: the hub's "Why teams behind a firewall" section
  const why = await context.newPage()
  await why.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await why.getByRole('heading', { name: /Why teams behind a firewall/ }).evaluate((h) => {
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 130)
  })
  await beat(800)
  await why.screenshot({ path: join(outDir, '4-why-offline.png') })
  await why.close()

  await context.close()
  await browser.close()

  for (const f of ['thumbnail.png', '1-hub.png', '2-craft-recording.png', '3-artist-editing.png', '4-why-offline.png']) {
    const p = join(outDir, f)
    if (!existsSync(p)) throw new Error(`missing output: ${p}`)
    console.log(`${f}  ${(statSync(p).size / 1024).toFixed(0)} KB`)
  }
}

await main()
