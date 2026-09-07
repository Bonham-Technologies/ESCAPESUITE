import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadBundle, loadManifest } from './loaders'
import type { LoadedJob } from './loaders'
import { buildManifest } from './manifest'
import { renderInChromium } from './renderDriver'
import { getSink } from './sinks'
import type { JobSpec, RenderOutcome } from './types'

export interface RunJobDeps {
  /** Absolute path to the inlined headless ARTIST bundle Chromium loads. */
  bundlePath: string
  /** Launch with GPU acceleration instead of `--disable-gpu`. */
  gpu?: boolean
  /** Chromium binary to use instead of Playwright's bundled one. */
  chromiumPath?: string
  /** Adds `--no-sandbox` (needed in most containers). */
  noSandbox?: boolean
  /** Overall render budget, passed straight to the driver. */
  timeoutMs?: number
  /** Where scratch files live. Defaults to the system temp dir. */
  workDir?: string
  versions: { engineVersion: string; kitVersion: string }
  onProgress?: (percent: number) => void
  /** Diagnostics sink; defaults to stderr so stdout stays clean for the CLI's own output. */
  log?: (line: string) => void
}

function defaultLog(line: string): void {
  process.stderr.write(line + '\n')
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Runs a cleanup step so a teardown failure is reported but never replaces the real outcome. */
async function tryCleanup(what: string, log: (line: string) => void, step: () => Promise<void>): Promise<void> {
  try {
    await step()
  } catch (err) {
    log(`[headless] warning: could not clean up ${what}: ${messageOf(err)}`)
  }
}

/**
 * Runs one job end to end: load the inputs, render in Chromium, build the verification
 * manifest, and hand both to the configured sink.
 *
 * Never throws — every failure comes back as `{ ok: false, error }` so the CLI has exactly
 * one outcome shape to print. Scratch files (the job work dir and any temp files the loader
 * wrote) are removed on every path, success or failure.
 */
export async function runJob(spec: JobSpec, deps: RunJobDeps): Promise<RenderOutcome> {
  const startedAt = Date.now()
  const log = deps.log ?? defaultLog
  const workDir = deps.workDir ?? os.tmpdir()
  const jobWorkDir = path.join(workDir, spec.jobId)
  let job: LoadedJob | undefined
  // The finally below removes jobWorkDir recursively, so it may only ever remove a directory
  // this call actually created.
  let createdJobDir = false

  try {
    // Belt and braces with parseJobSpec's own jobId rule: a job id that escaped its work dir
    // (".", "..", anything that resolves elsewhere) must never reach an rm -rf.
    if (path.dirname(path.resolve(jobWorkDir)) !== path.resolve(workDir)) {
      throw new Error(`jobId "${spec.jobId}" does not name a directory inside the work dir`)
    }

    if ('bundle' in spec.input) {
      // loadBundle mkdtemps inside workDir, so the root has to exist first.
      await fs.mkdir(workDir, { recursive: true })
      job = await loadBundle(spec.input.bundle.path, workDir)
    } else {
      job = await loadManifest(spec.input.manifest.path)
    }

    await fs.mkdir(jobWorkDir, { recursive: true })
    createdJobDir = true
    const outputPath = path.join(jobWorkDir, `render.${spec.options.format}`)

    const { meta, chromiumVersion } = await renderInChromium(
      deps.bundlePath,
      job,
      spec.options,
      outputPath,
      {
        gpu: deps.gpu,
        chromiumPath: deps.chromiumPath,
        noSandbox: deps.noSandbox,
        timeoutMs: deps.timeoutMs,
        onProgress: deps.onProgress,
        log,
      },
    )

    const manifest = await buildManifest(spec.jobId, outputPath, meta, {
      chromiumVersion,
      ...deps.versions,
    })

    const sink = await getSink(spec.output.sink, spec.output.config)
    // Sinks may move the output (the volume sink renames it), so nothing may touch
    // outputPath after this point.
    const { outputLocation, manifestLocation } = await sink.deliver(spec.jobId, outputPath, manifest)

    return {
      jobId: spec.jobId,
      ok: true,
      meta,
      outputLocation,
      ...(manifestLocation ? { manifestLocation } : {}),
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    const error = messageOf(err)
    log(`error: ${error}`)
    return { jobId: spec.jobId, ok: false, error, durationMs: Date.now() - startedAt }
  } finally {
    if (createdJobDir) {
      await tryCleanup('the job work directory', log, () =>
        fs.rm(jobWorkDir, { recursive: true, force: true }),
      )
    }
    await tryCleanup('the loader temp files', log, async () => {
      await job?.cleanup()
    })
  }
}
