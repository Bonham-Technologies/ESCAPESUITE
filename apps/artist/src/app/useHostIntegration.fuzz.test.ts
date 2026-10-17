// Seeded mutation fuzz for the host's inbound payloads (ESCSUITE-294): the
// three messages that carry one, driven through the handler the hook gives
// `initIntegration`, exactly as useHostIntegration.test.ts drives them.
//
// The contract (ESCSUITE-232, ESCSUITE-102):
//   - LOAD_VIDEO without a string `url`, and SET_THEME without a known theme,
//     get exactly one ERROR with `code: 'INVALID_MESSAGE'` and apply nothing;
//   - LOAD_PROJECT with no object payload gets exactly one INVALID_MESSAGE; an
//     object `parseProject` refuses gets exactly one ERROR with
//     `code: 'INVALID_PROJECT'` and the parse reason; neither applies anything;
//   - whatever is accepted is applied once and answered with no ERROR;
//   - and the handler itself never throws.
//
// A failure prints the seed, the iteration and the mutation; rerun this file
// to reproduce it. See src/test/fuzz.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHostIntegration, type HostIntegrationDeps } from './useHostIntegration'
import { initIntegration, loadVideoFromUrl, sendMessage } from '../utils/integration'
import { processMediaFile } from '../core/videoProcessor'
import { getTheme, setTheme } from '@escapesuite/shared/theme'
import { parseProject } from '../store/projectMigration'
import { resetStoreForTest } from '../test/fixtures/projectStore'
import { defaultUrlParams, sampleVideo } from '../test/appDoubles'
import {
  createRng,
  expectNamedRefusal,
  expectTallyAtLeast,
  fuzzFailure,
  mutateJson,
  nestDeep,
  setAt,
  type FuzzContext,
} from '../test/fuzz'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
vi.mock('../utils/integration', async () => (await import('../test/appDoubles')).integrationDouble())
vi.mock('../core/videoProcessor', async () =>
  (await import('../test/appDoubles')).videoProcessorDouble()
)

const SEED = 0x5eed0232
const ITERATIONS = 200
// Outcomes on the committed seed, measured 2026-10-15; the floors ARE those
// counts, so a check dropped anywhere lowers `refused` (a change that moves an
// input across the line on purpose updates them and says why). LOAD_VIDEO and
// SET_THEME refused all 200: their payloads have one field, so every mutation
// breaks it, and the accepting side is the sanity case's. LOAD_PROJECT applied
// 108 and refused 92.
//
// Re-measured 2026-10-16 for ESCSUITE-302: LOAD_PROJECT applied 96 and refused
// 104. Exactly 12 payloads crossed, every one a mutation of the clip's
// `startTime` or `endTime`, which `parseProject` now refuses by name
// (INVALID_PROJECT): 2 leave it absent (the key deleted, or set to undefined)
// and 10 replace it with something that is not a number (a string, null, a
// boolean, a list, a nested object). Each used to be applied as a clip whose
// source time read as NaN.
const FLOORS = {
  LOAD_VIDEO: { accepted: 0, refused: 200 },
  SET_THEME: { accepted: 0, refused: 200 },
  LOAD_PROJECT: { accepted: 96, refused: 104 },
}
const THEME_MODULE_DEFAULT = 'dark' as const

type Handler = (message: { type: string; payload?: unknown }) => Promise<void> | void

let deps: HostIntegrationDeps

/** Mount once and hand back the inbound handler; each iteration clears what it observed. */
async function mountHandler(): Promise<Handler> {
  deps = {
    urlParams: defaultUrlParams(),
    addSourceVideo: vi.fn(),
    setProject: vi.fn(),
    showNotification: vi.fn(),
    sessionDecisionPending: false,
  }
  renderHook(() => useHostIntegration(deps))
  await act(async () => {
    await Promise.resolve()
  })
  return vi.mocked(initIntegration).mock.calls[0][0] as Handler
}

/** Deliver one message and wait for what it does synchronously and on the next tick. */
async function deliver(handler: Handler, message: { type: string; payload?: unknown }): Promise<void> {
  await act(async () => {
    await handler(message)
    await Promise.resolve()
  })
}

function clearObservations(): void {
  vi.mocked(sendMessage).mockClear()
  vi.mocked(loadVideoFromUrl).mockClear()
  vi.mocked(deps.setProject).mockClear()
  vi.mocked(deps.addSourceVideo).mockClear()
}

const errorsSent = () =>
  vi.mocked(sendMessage).mock.calls.map(([message]) => message).filter((message) => message.type === 'ERROR')

/** Exactly one ERROR, with this code and a message; anything else breaks the contract. */
function expectOneError(context: FuzzContext, code: string): void {
  const sent = vi.mocked(sendMessage).mock.calls.map(([message]) => message)
  const [only] = sent
  const payload = only?.payload as { code?: unknown; message?: unknown } | undefined
  if (
    sent.length !== 1 ||
    only.type !== 'ERROR' ||
    payload?.code !== code ||
    typeof payload.message !== 'string' ||
    payload.message.length === 0
  ) {
    throw fuzzFailure(context, `expected one ERROR ${code}, sent ${JSON.stringify(sent)}`)
  }
}

function expectNoError(context: FuzzContext): void {
  if (errorsSent().length > 0) {
    throw fuzzFailure(context, `accepted, yet sent ${JSON.stringify(errorsSent())}`)
  }
}

/**
 * One mutated `{ payload }` per iteration, so the mutation's path reads
 * `payload.<field>`; an iteration that sent an ERROR counts as refused.
 */
async function fuzzPayloads(
  type: keyof typeof FLOORS,
  basePayload: () => unknown,
  check: (payload: unknown, context: FuzzContext) => void
): Promise<void> {
  const handler = await mountHandler()
  const rng = createRng(SEED)
  const tally = { accepted: 0, refused: 0 }
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const { value, description } = mutateJson(rng, { payload: basePayload() })
    const payload = (value as { payload?: unknown } | null | undefined)?.payload
    const context = { seed: SEED, iteration, mutation: `${type} ${description}` }
    clearObservations()
    // The handler refuses by reply, so no thrown error is expected at all.
    await expectNamedRefusal(() => deliver(handler, { type, payload }), () => false, context)
    check(payload, context)
    tally[errorsSent().length > 0 ? 'refused' : 'accepted']++
  }
  expectTallyAtLeast(tally, FLOORS[type], SEED)
}

beforeEach(() => {
  resetStoreForTest()
  vi.mocked(initIntegration).mockReturnValue(() => {})
  vi.mocked(loadVideoFromUrl).mockResolvedValue({ blob: new Blob(), name: 'test.mp4' })
  vi.mocked(processMediaFile).mockResolvedValue({ ...sampleVideo })
})

afterEach(async () => {
  await setTheme(THEME_MODULE_DEFAULT)
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const hostProject = () => ({
  id: 'host',
  name: 'From Host',
  created: 0,
  modified: 0,
  resolution: { width: 1280, height: 720 },
  timeline: {
    tracks: [{ id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }],
    clips: [
      {
        id: 'c1',
        sourceVideoId: 'v1',
        name: 'Clip 1',
        startTime: 0,
        endTime: 3,
        duration: 3,
        trackId: 't1',
        timelinePosition: 0,
        blendMode: 'normal',
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        effects: { blur: 0 },
        transition: { type: 'none', duration: 0.5 },
      },
    ],
    textOverlays: [],
    shapeOverlays: [],
    duration: 3,
  },
})

describe('host payloads under seeded mutation (ESCSUITE-294)', () => {
  it('applies the unmutated payloads, so every mutation starts from a message the editor takes', async () => {
    const handler = await mountHandler()
    await deliver(handler, { type: 'LOAD_PROJECT', payload: hostProject() })
    await deliver(handler, { type: 'LOAD_VIDEO', payload: { url: 'https://host.example/clip.mp4' } })
    expect(deps.setProject).toHaveBeenCalledTimes(1)
    expect(deps.addSourceVideo).toHaveBeenCalledTimes(1)
    expect(errorsSent()).toEqual([])
  })

  it(`answers ${ITERATIONS} mutated LOAD_VIDEO payloads by loading or with one INVALID_MESSAGE`, async () => {
    await fuzzPayloads('LOAD_VIDEO', () => ({ url: 'https://host.example/clip.mp4' }), (payload, context) => {
      const url = (payload as { url?: unknown } | null | undefined)?.url
      if (typeof url === 'string') {
        expectNoError(context)
        if (vi.mocked(deps.addSourceVideo).mock.calls.length !== 1) {
          throw fuzzFailure(context, 'a string url was not loaded once')
        }
        return
      }
      expectOneError(context, 'INVALID_MESSAGE')
      if (vi.mocked(loadVideoFromUrl).mock.calls.length > 0 || vi.mocked(deps.addSourceVideo).mock.calls.length > 0) {
        throw fuzzFailure(context, 'a refused LOAD_VIDEO fetched or added a video')
      }
    })
  })

  it(`answers ${ITERATIONS} mutated SET_THEME payloads by applying or with one INVALID_MESSAGE`, async () => {
    await fuzzPayloads('SET_THEME', () => ({ theme: THEME_MODULE_DEFAULT }), (payload, context) => {
      const theme = (payload as { theme?: unknown } | null | undefined)?.theme
      if (theme === 'light' || theme === 'dark' || theme === 'system') {
        expectNoError(context)
        return
      }
      expectOneError(context, 'INVALID_MESSAGE')
      if (getTheme() !== THEME_MODULE_DEFAULT) {
        throw fuzzFailure(context, `a refused SET_THEME changed the theme to ${getTheme()}`)
      }
    })
  })

  it(`answers ${ITERATIONS} mutated LOAD_PROJECT payloads by applying or with one ERROR`, async () => {
    await fuzzPayloads('LOAD_PROJECT', hostProject, (payload, context) => {
      const applied = vi.mocked(deps.setProject).mock.calls.length
      if (!payload || typeof payload !== 'object') {
        expectOneError(context, 'INVALID_MESSAGE')
      } else if (parseProject(payload).ok) {
        expectNoError(context)
        if (applied !== 1) throw fuzzFailure(context, `an accepted project was applied ${applied} times`)
        return
      } else {
        expectOneError(context, 'INVALID_PROJECT')
      }
      if (applied > 0) throw fuzzFailure(context, 'a refused LOAD_PROJECT was applied')
    })
  })
})

// The defect this fuzzer found, its one input pinned on its own so it reads
// without the loop: parseProject's (store/projectMigration.fuzz.test.ts),
// reached through the host channel, where the throw becomes an unhandled
// rejection and the host gets no reply at all. Fixed in parseProject in the
// same ticket (ESCSUITE-294) and kept as a regression test.
describe('the defect the host payload fuzz found (ESCSUITE-294)', () => {
  it('LOAD_PROJECT whose legacy textOverlays is not a list gets one INVALID_PROJECT, not a throw (seed 0x5eed0232, iteration 115)', async () => {
    const context = {
      seed: SEED,
      iteration: 115,
      mutation: 'LOAD_PROJECT nestDeep payload.timeline.textOverlays -> depth 36',
    }
    const payload = setAt(hostProject(), ['timeline', 'textOverlays'], nestDeep(36))
    const handler = await mountHandler()
    await expectNamedRefusal(() => deliver(handler, { type: 'LOAD_PROJECT', payload }), () => false, context)
    expectOneError(context, 'INVALID_PROJECT')
    expect(deps.setProject).not.toHaveBeenCalled()
  })
})
