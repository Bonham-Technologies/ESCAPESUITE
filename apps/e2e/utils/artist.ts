import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Frame, Page, expect } from '@playwright/test'

/**
 * ESCAPEARTIST test helpers.
 *
 * Every helper takes a `Page` or a `Frame`: ESCAPEARTIST is also driven inside
 * an iframe (see tests/integration/host-embedding.spec.ts), and the locator
 * calls below are identical on both, so one signature covers both callers.
 */
type ArtistScope = Page | Frame

export const ARTIST_URL = 'http://localhost:5175'

/**
 * The same one-second fixture the integration and perf suites import — the
 * cheapest way to get a real, decodable *media* clip onto the timeline.
 *
 * `utils/perf.ts`'s `PERF_SOURCE_PATH` resolves the same file independently
 * (the perf suite has its own reasons to stay decoupled from this module);
 * everything under `tests/` should use this export instead of re-declaring
 * the `resolvePath(dirname(fileURLToPath(import.meta.url)), …)` path.
 */
export const ARTIST_FIXTURE_MP4 = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/headless/source.mp4'
)

/**
 * Put one clip on the ESCAPEARTIST timeline.
 *
 * "Export video" stays disabled while the timeline is empty — there is nothing
 * to encode — so any test whose subject is the export dialog has to seed a clip
 * first. A text overlay is the cheapest seed there is: no file to upload and no
 * media to decode, one click creates both the clip and the track holding it.
 */
export async function seedTextClip(page: ArtistScope): Promise<void> {
  await page.getByRole('button', { name: 'Add Text' }).click()
  await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible({ timeout: 15_000 })
}

/**
 * Open the export dialog. The project must already hold a clip — see
 * {@link seedTextClip}.
 *
 * Idempotent: calling it on an already-open dialog leaves it open rather than
 * clicking "Export video" a second time. Callers that export more than once in
 * a row (the perf benchmarks) would otherwise have to track dialog state
 * themselves.
 */
export async function openExportDialog(page: ArtistScope): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Export Video' })
  if (!(await heading.isVisible())) {
    const exportButton = page.getByRole('button', { name: 'Export video' })
    await expect(exportButton).toBeEnabled()
    await exportButton.click()
  }
  await expect(heading).toBeVisible()
}

/**
 * Reveal the export dialog's format / quality / resolution controls, which sit
 * behind an "Advanced options" disclosure.
 *
 * Idempotent, and for a sharper reason than tidiness: the dialog stays mounted
 * when it closes, so its disclosure state survives into the next open. A blind
 * click would then *collapse* the controls the caller asked to see. The
 * disclosure publishes `aria-expanded`, so ask it.
 */
export async function openExportAdvancedOptions(page: ArtistScope): Promise<void> {
  const disclosure = page.getByRole('button', { name: 'Advanced options' })
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') {
    await disclosure.click()
  }
  await expect(page.getByRole('radio', { name: /WebM/ })).toBeVisible()
}

/**
 * Import a real media file through the library's file input and add it to
 * the timeline — one clip, selected on a track of its own.
 *
 * Defaults to {@link ARTIST_FIXTURE_MP4}; pass a Playwright file payload
 * (`{ name, mimeType, buffer }`, the shape {@link makeToneWav} produces) for
 * synthesised media instead of a path on disk.
 */
export async function importMediaAndAddToTimeline(
  page: ArtistScope,
  file: string | { name: string; mimeType: string; buffer: Buffer } = ARTIST_FIXTURE_MP4
): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(file)
  const addToTimeline = page.getByRole('button', { name: 'Add to timeline' })
  await expect(addToTimeline).toBeVisible({ timeout: 30_000 })
  await addToTimeline.click()
  await expect(page.getByText(/^1 clip/).first()).toBeVisible({ timeout: 15_000 })
}

/**
 * A tiny real WAV file: a one-second mono tone, synthesised rather than
 * loaded from a fixture — `extractWaveformData` decodes real audio bytes via
 * `AudioContext.decodeAudioData` (`app/takeImport.ts`/`core/videoProcessor.ts`),
 * so nothing short of real, decodable audio produces a real waveform to
 * assert against, and the shared MP4 fixture has no audio track at all.
 */
export function makeToneWav(durationSec: number, sampleRate = 8000, freq = 440): Buffer {
  const numSamples = Math.floor(durationSec * sampleRate)
  const dataSize = numSamples * 2 // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 16000)
    buffer.writeInt16LE(sample, 44 + i * 2)
  }
  return buffer
}

/**
 * The keyframe editor panel.
 *
 * It is a `createPortal` sibling of `#root`, which itself has an "Open/Close
 * Keyframe Editor" button of its own — scoped past that with `:not()`.
 */
export function keyframePanel(page: ArtistScope) {
  return page.locator('body > div:not(#root)').filter({ hasText: 'Keyframe Editor' })
}

/** The clip inspector's sidebar. */
export function inspector(page: ArtistScope) {
  return page.locator('aside[aria-labelledby="inspector-title"]')
}
