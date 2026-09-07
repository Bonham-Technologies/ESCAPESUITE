import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import type { LoadedJob } from './loaders'
import type { RenderFileInput, RenderInput, RenderMeta } from './types'

/** Selector of the hidden file input the bundle reads sources from. */
const SOURCE_INPUT_SELECTOR = '#__sources'

/** Download name the page uses; the extension is appended by the bundle. */
const OUTPUT_NAME = 'render'

/** Nothing sane renders for half an hour; past that, assume the page is wedged. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

export interface RenderDriverOptions {
  /** Launch with GPU acceleration instead of `--disable-gpu`. */
  gpu?: boolean
  /** Chromium binary to use instead of Playwright's bundled one. */
  chromiumPath?: string
  /** Adds `--no-sandbox` (needed in most containers). */
  noSandbox?: boolean
  /** Overall budget for the whole render, launch included. Default 30 minutes. */
  timeoutMs?: number
  onProgress?: (percent: number) => void
  /** Diagnostics sink; defaults to stderr so stdout stays clean for the CLI's own output. */
  log?: (line: string) => void
}

export interface DriverResult {
  outputPath: string
  meta: RenderMeta
  chromiumVersion: string
}

/** What the render entry points look like on the bundle's `window`. */
interface HeadlessWindow {
  __headlessReady?: boolean
  __renderProjectToFile: (input: RenderFileInput, onProgress?: (percent: number) => void) => Promise<RenderMeta>
  __hlProgress: (percent: number) => void
}

/**
 * The evaluate payload. Deliberately small: metadata only, never file contents —
 * source bytes go in through the file input and the result comes out as a download.
 */
interface RenderPayload {
  project: RenderFileInput['project']
  sourceVideos: RenderFileInput['sourceVideos']
  /** id → file *name*, because the page can only match its FileList by `File.name`. */
  sourceFilesByName: Record<string, string>
  options: RenderInput['options']
  outputName: string
}

function defaultLog(line: string): void {
  process.stderr.write(line + '\n')
}

function launchArgs(opts: RenderDriverOptions): string[] {
  const args = ['--autoplay-policy=no-user-gesture-required']
  if (opts.gpu) args.push('--use-gl=angle', '--ignore-gpu-blocklist', '--enable-features=Vulkan')
  else args.push('--disable-gpu')
  if (opts.noSandbox) args.push('--no-sandbox')
  return args
}

/** A promise that rejects once the budget is spent, plus the cancel that stops the timer. */
function createDeadline(timeoutMs: number): { promise: Promise<never>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`render timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  // The race below observes this, but it can fire before the race exists (a tiny
  // timeout during launch), and an unobserved rejection would crash the process.
  promise.catch(() => {})
  return { promise, cancel: () => clearTimeout(timer) }
}

/** A promise that rejects when the page dies under us, so a crash isn't waited out. */
function watchPageFailures(page: Page): Promise<never> {
  const promise = new Promise<never>((_, reject) => {
    page.on('crash', () => reject(new Error('Chromium page crashed')))
    page.on('pageerror', (error) => reject(new Error(error.message)))
  })
  promise.catch(() => {})
  return promise
}

/** Forwards progress to the caller and logs it once per whole percent. */
function progressReporter(
  onProgress: ((percent: number) => void) | undefined,
  log: (line: string) => void,
): (percent: number) => void {
  let lastLogged = -1
  return (percent) => {
    onProgress?.(percent)
    const whole = Math.floor(percent)
    if (whole === lastLogged) return
    lastLogged = whole
    log(`[headless] progress ${whole}%`)
  }
}

/** Runs inside the page — must reference nothing from this module's scope. */
function evaluateRender(payload: RenderPayload): Promise<RenderMeta> {
  const target = window as unknown as HeadlessWindow
  return target.__renderProjectToFile(
    {
      project: payload.project,
      sourceVideos: payload.sourceVideos,
      sourceFiles: payload.sourceFilesByName,
      options: payload.options,
      outputName: payload.outputName,
    },
    (percent) => target.__hlProgress(percent),
  )
}

/** Load the bundle, stream the sources in, render, and save the download out. */
async function driveRender(
  page: Page,
  bundleHtmlPath: string,
  job: LoadedJob,
  options: RenderInput['options'],
  outputPath: string,
): Promise<RenderMeta> {
  await page.goto(pathToFileURL(bundleHtmlPath).href)
  await page.waitForFunction(() => (window as unknown as HeadlessWindow).__headlessReady === true)
  await page.setInputFiles(SOURCE_INPUT_SELECTOR, Object.values(job.sourceFiles))

  const payload: RenderPayload = {
    project: job.project,
    sourceVideos: job.sourceVideos,
    sourceFilesByName: Object.fromEntries(
      Object.entries(job.sourceFiles).map(([id, filePath]) => [id, path.basename(filePath)]),
    ),
    options,
    outputName: OUTPUT_NAME,
  }

  // The download fires from the anchor click inside the page, which happens just
  // before __renderProjectToFile resolves — so both are awaited together.
  const [download, meta] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(evaluateRender, payload),
  ])
  await download.saveAs(outputPath)
  return meta
}

/**
 * Renders one job in a throwaway headless Chromium and writes the encoded video to
 * `outputPath`. Source bytes are streamed in through the page's hidden file input and
 * the result is collected as a browser download, so nothing large crosses the evaluate
 * boundary. The page is air-gapped: every http(s) request is aborted, and the inline
 * bundle needs none.
 */
export async function renderInChromium(
  bundleHtmlPath: string,
  job: LoadedJob,
  options: RenderInput['options'],
  outputPath: string,
  opts: RenderDriverOptions = {},
): Promise<DriverResult> {
  const log = opts.log ?? defaultLog
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  try {
    await fs.access(bundleHtmlPath)
  } catch {
    throw new Error(`headless bundle not found at ${bundleHtmlPath}`)
  }

  const startedAt = Date.now()
  const deadline = createDeadline(timeoutMs)

  try {
    // The launch itself is bounded by Playwright's own launch timeout, so it cannot
    // outlive a wedged browser binary; from here on the deadline covers everything.
    const browser = await chromium.launch({
      headless: true,
      args: launchArgs(opts),
      ...(opts.chromiumPath ? { executablePath: opts.chromiumPath } : {}),
    })

    try {
      const chromiumVersion = browser.version()
      const executable = opts.chromiumPath ? ` executable=${opts.chromiumPath}` : ''
      log(`[headless] chromium ${chromiumVersion} gpu=${!!opts.gpu}${executable}`)

      const context = await browser.newContext({ acceptDownloads: true })
      const page = await context.newPage()
      page.setDefaultTimeout(timeoutMs)
      const failures = watchPageFailures(page)
      page.on('console', (message) => {
        if (message.type() === 'error') log(`[page] ${message.text()}`)
      })
      // The bundle is fully inline; anything reaching the network would be a regression.
      await page.route(/^https?:/, (route) => route.abort())
      await page.exposeFunction('__hlProgress', progressReporter(opts.onProgress, log))

      const meta = await Promise.race([
        driveRender(page, bundleHtmlPath, job, options, outputPath),
        failures,
        deadline.promise,
      ])

      log(`[headless] render complete: ${meta.byteLength} bytes in ${Date.now() - startedAt} ms`)
      // The page cannot know how it was launched, so the driver owns this flag.
      return { outputPath, meta: { ...meta, gpu: !!opts.gpu }, chromiumVersion }
    } finally {
      // Never let a teardown failure mask the render's own error.
      await browser.close().catch(() => {})
    }
  } finally {
    // Also cancels when the launch itself failed, so no timer outlives the call.
    deadline.cancel()
  }
}
