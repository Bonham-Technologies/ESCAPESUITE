/**
 * Unit tests for `report-nightly.mjs` (ESCSUITE-353), plus a weak guard on
 * `.github/workflows/nightly.yml`: it greps the YAML for the tokens the nightly
 * depends on (it cannot run the workflow; a workflow_dispatch run does that).
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findFailedTests, toSummary } from './report-nightly.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'report-nightly.mjs')
const repoRoot = path.resolve(here, '../../..')

const result = (retry, status) => ({ retry, status })

/** Shaped like Playwright's JSON reporter output. */
const report = {
  config: { rootDir: '/repo/apps/e2e/tests' },
  suites: [
    {
      title: 'escapeplan/home.spec.ts',
      file: 'escapeplan/home.spec.ts',
      specs: [
        {
          title: 'loads',
          file: 'escapeplan/home.spec.ts',
          line: 4,
          tests: [
            { projectName: 'chromium', status: 'expected', results: [result(0, 'passed')] },
            {
              projectName: 'webkit',
              status: 'unexpected',
              results: [result(0, 'failed'), result(1, 'failed'), result(2, 'timedOut')],
            },
          ],
        },
      ],
      suites: [
        {
          title: 'Hero',
          file: 'escapeplan/home.spec.ts',
          specs: [
            {
              title: 'plays | the reel',
              file: 'escapeplan/home.spec.ts',
              line: 12,
              tests: [
                { projectName: 'firefox', status: 'flaky', results: [result(0, 'failed'), result(1, 'passed')] },
                { projectName: 'firefox', status: 'skipped', results: [] },
                { projectName: 'chromium-strict', status: 'unexpected', results: [result(0, 'failed')] },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test('finds only tests that failed on every attempt, with project and last result', () => {
  assert.deepEqual(findFailedTests(report), [
    { file: 'escapeplan/home.spec.ts', line: 4, title: 'loads', project: 'webkit', status: 'timedOut' },
    {
      file: 'escapeplan/home.spec.ts',
      line: 12,
      title: 'Hero › plays | the reel',
      project: 'chromium-strict',
      status: 'failed',
    },
  ])
  assert.deepEqual(findFailedTests({}), [])
})

test('the summary names the seed with its replay command and lists the failures', () => {
  const md = toSummary({ failed: findFailedTests(report), seed: '1234', runs: '5000', propertyOutcome: 'failure' })
  assert.match(md, /Seed \*\*1234\*\*, 5000 runs: failure\./)
  assert.match(md, /ARTIST_FUZZ_SEED=1234 ARTIST_FUZZ_RUNS=5000 pnpm --filter=@escapesuite\/artist exec vitest run/)
  assert.match(md, /2 failing test\(s\)/)
  assert.match(md, /\| `escapeplan\/home.spec.ts:12` \| Hero › plays \\\| the reel \| chromium-strict \| failed \|/)
  assert.match(toSummary({ failed: [], seed: '1' }), /No failing tests\./)
  assert.match(toSummary({ failed: null, reportNote: 'gone' }), /gone/)
})

test('an empty seed or outcome (a step that never ran) reads as unknown, not blank', () => {
  const md = toSummary({ failed: [], seed: '', runs: '', propertyOutcome: '' })
  assert.match(md, /Seed \*\*unknown\*\*, unknown runs: unknown\./)
  assert.match(md, /ARTIST_FUZZ_SEED=<seed> ARTIST_FUZZ_RUNS=5000 pnpm/)
})

test('the CLI appends to the step summary, and notes a missing report without failing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-nightly-'))
  const reportPath = path.join(dir, 'results.json')
  const summaryPath = path.join(dir, 'summary.md')
  writeFileSync(reportPath, JSON.stringify(report))
  writeFileSync(summaryPath, '')
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summaryPath, ARTIST_FUZZ_SEED: '42', ARTIST_FUZZ_RUNS: '5000', PROPERTY_OUTCOME: 'success' }
  execFileSync(process.execPath, [script, reportPath], { env, encoding: 'utf8' })
  const md = readFileSync(summaryPath, 'utf8')
  assert.match(md, /Seed \*\*42\*\*, 5000 runs: success\./)
  assert.match(md, /2 failing test\(s\)/)

  // execFileSync throws on a non-zero exit, so returning at all proves exit 0.
  const stdout = execFileSync(process.execPath, [script, path.join(dir, 'nope.json')], {
    env: { ...env, GITHUB_STEP_SUMMARY: '' },
    encoding: 'utf8',
  })
  assert.match(stdout, /No Playwright JSON report at .*nope\.json/)
  assert.match(stdout, /Seed \*\*42\*\*/)
})

const nightlyYml = readFileSync(path.join(repoRoot, '.github/workflows/nightly.yml'), 'utf8')
const ciYml = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')

test('nightly.yml runs at 11:00 UTC and on dispatch, with every nightly knob set', () => {
  assert.match(nightlyYml, /cron: '0 11 \* \* \*'/)
  assert.match(nightlyYml, /^\s{2}workflow_dispatch:/m)
  assert.match(nightlyYml, /run: pnpm test:e2e:browsers/)
  for (const knob of [/E2E_CROSS_BROWSER: '1'/, /E2E_NIGHTLY: '1'/, /SOAK_CYCLES: '200'/, /SOAK_RELOADS: '30'/, /ARTIST_FUZZ_RUNS: '5000'/]) {
    assert.match(nightlyYml, knob)
  }
  assert.match(nightlyYml, /GITHUB_RUN_ID % 2147483647/)
  assert.match(nightlyYml, /playwright install chromium firefox webkit/)
  assert.match(nightlyYml, /node scripts\/report-nightly\.mjs/)
  assert.match(nightlyYml, /path: apps\/e2e\/playwright-report\//)
})

// ESCSUITE-389: the runner has no sound device, and without one Firefox's AudioContext
// never leaves `suspended`, so CRAFT's recorder waits on `resume()` forever and every
// Firefox recording test times out at Start. The nightly starts a PulseAudio null sink first.
test('nightly.yml gives Firefox an audio sink before the e2e step', () => {
  const sinkStep = nightlyYml.indexOf('- name: Start a PulseAudio null sink')
  const e2eStep = nightlyYml.indexOf('- name: Run E2E tests (Chromium, Firefox, WebKit)')
  assert.ok(sinkStep > 0, 'nightly.yml has no PulseAudio step')
  assert.ok(sinkStep < e2eStep, 'the PulseAudio step must come before the e2e step')
  const step = nightlyYml.slice(sinkStep, e2eStep)
  assert.match(step, /apt-get install -y[^\n]*pulseaudio/)
  assert.match(step, /pulseaudio --start/)
  assert.match(step, /module-null-sink/)
  // A sink that never came up must fail this step, not 35 tests an hour later.
  assert.match(step, /pactl list short sinks/)
  assert.match(nightlyYml.slice(e2eStep), /^\s+if: .*steps\.audio-sink\.outcome == 'success'/m)
  // playwright.config.ts keeps Chromium off the sink only when the e2e step sets this: on it,
  // Chromium's <video> clock stalls.
  const nextStep = nightlyYml.indexOf('\n      - name:', e2eStep + 1)
  assert.match(nightlyYml.slice(e2eStep, nextStep), /^\s+E2E_PULSE_NULL_SINK: '1'$/m)
  const playwrightConfig = readFileSync(path.join(repoRoot, 'apps/e2e/playwright.config.ts'), 'utf8')
  assert.match(playwrightConfig, /process\.env\.E2E_PULSE_NULL_SINK === '1'/)
  assert.match(playwrightConfig, /PULSE_SERVER: /)
})

test('ci-status does not depend on the nightly', () => {
  const ciStatus = ciYml.slice(ciYml.indexOf('\n  ci-status:'))
  assert.ok(ciStatus.length > 1, 'ci.yml has no ci-status job')
  assert.doesNotMatch(ciStatus, /nightly/i)
})

test('the nightly pins its actions the way ci.yml does', () => {
  const uses = (yml) => new Set([...yml.matchAll(/uses: (\S+)/g)].map((m) => m[1]))
  const ciUses = uses(ciYml)
  for (const action of uses(nightlyYml)) assert.ok(ciUses.has(action), `${action} is not pinned as in ci.yml`)
})
