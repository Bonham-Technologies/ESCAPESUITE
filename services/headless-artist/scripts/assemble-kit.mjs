#!/usr/bin/env node
/**
 * Assembles the shippable kit into `dist/`:
 *
 *   dist/cli.js        the CLI, bundled to a single ESM file (deps stay external)
 *   dist/headless.html the inlined ARTIST render bundle the CLI drives in Chromium
 *   dist/kit.json      the versions `--version` prints and every render manifest records
 *
 * Idempotent: every run overwrites what the last one wrote, and nothing else. Node built-ins
 * only, so the kit can be assembled without installing anything beyond the workspace itself.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const DIST = path.join(SERVICE_ROOT, 'dist')
const DOCKERFILE = path.join(SERVICE_ROOT, 'Dockerfile')
const HEADLESS_HTML = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')

const require = createRequire(import.meta.url)

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function run(command, args, cwd) {
  console.log(`[kit] ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

/** The short commit the kit was built from; a tarball unpacked outside a checkout has none. */
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * The reference Dockerfile pins a Playwright image that ships a matching browser build. If the
 * lockfile moves and the image tag doesn't, the container silently runs a Chromium the driver
 * was never tested against — so refuse to assemble a kit whose Dockerfile has drifted.
 */
function assertDockerfileMatches(playwrightVersion) {
  const expected = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`
  const dockerfile = readFileSync(DOCKERFILE, 'utf8')
  const match = /^FROM\s+(\S+)/m.exec(dockerfile)

  if (!match) {
    throw new Error(`${DOCKERFILE} has no FROM line; expected "FROM ${expected}"`)
  }
  if (match[1] !== expected) {
    throw new Error(
      `Dockerfile base image "${match[1]}" does not match the pinned Playwright ${playwrightVersion}.\n` +
        `Update the FROM line in ${DOCKERFILE} to:\n  FROM ${expected}`,
    )
  }
}

function assemble() {
  const kitVersion = readJson(path.join(SERVICE_ROOT, 'package.json')).version
  const engineVersion = readJson(path.join(REPO_ROOT, 'apps/artist/package.json')).version
  const playwrightVersion = readJson(require.resolve('playwright/package.json')).version

  // Cheap and fatal, so check it before the two slow builds.
  assertDockerfileMatches(playwrightVersion)

  // esbuild creates its own output directory, but the chmod and the copy below assume one, so
  // make it unconditionally first rather than depending on which step happens to run.
  mkdirSync(DIST, { recursive: true })

  run('pnpm', ['--filter=@escapesuite/artist', 'run', 'build:headless'], REPO_ROOT)
  run(
    'pnpm',
    [
      'exec',
      'esbuild',
      'src/cli.ts',
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--packages=external',
      '--outfile=dist/cli.js',
    ],
    SERVICE_ROOT,
  )

  // esbuild carries the entry point's own hashbang through, but not the executable bit.
  chmodSync(path.join(DIST, 'cli.js'), 0o755)
  copyFileSync(HEADLESS_HTML, path.join(DIST, 'headless.html'))

  const kit = {
    kitVersion,
    engineVersion,
    commit: gitCommit(),
    playwrightVersion,
    builtAt: new Date().toISOString(),
  }
  writeFileSync(path.join(DIST, 'kit.json'), JSON.stringify(kit, null, 2) + '\n')

  console.log(`[kit] assembled ${DIST}: ${JSON.stringify(kit)}`)
}

try {
  assemble()
} catch (err) {
  // A build failure is a message for a human, not a stack trace through Node's ESM loader.
  // The child processes already printed their own output on the way past.
  console.error(`[kit] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
