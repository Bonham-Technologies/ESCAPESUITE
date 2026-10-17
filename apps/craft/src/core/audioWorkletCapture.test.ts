// ESCSUITE-299: the WebCodecs recorder's audio capture.
//
// An `AudioWorkletProcessor` runs on the render thread for every 128-frame
// quantum without exception and knows the render position exactly
// (`currentFrame`); what it posts over its port is queued, never dropped. So
// the capture it feeds stamps each chunk from where it was *rendered*, however
// late the page receives it — no gap filler, no thresholds. A browser that has
// no AudioWorklet, or whose `addModule()` refuses the module, gets the
// ScriptProcessorNode capture ESCSUITE-296 left, gap filler and all.
//
// The processor that runs here is the real source text: the AudioWorklet
// double evaluates the Blob the module hands `URL.createObjectURL()`.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import {
  createAudioCapture,
  AUDIO_CAPTURE_PROCESSOR_NAME,
  AUDIO_CAPTURE_WORKLET_SOURCE,
  CHUNK_FRAMES,
  FLUSH_TIMEOUT_MS,
  POOL_PAIRS,
  type AudioCapture,
} from './audioWorkletCapture'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  getCreatedFrames,
  type FrameDouble,
} from '../test/doubles/webcodecs'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  enableAudioWorkletDouble,
  createAudioBufferDouble,
  type AudioContextDoubleControl,
  type AudioContextDoubleInstance,
  type AudioWorkletDoubleControl,
  type AudioWorkletNodeDouble,
} from '../test/doubles/audio'

let audio: AudioContextDoubleControl
let encoded: FrameDouble[]
let onChunk: Mock<(data: AudioData) => void>
let consoleInfo: ReturnType<typeof vi.spyOn>
let consoleWarn: ReturnType<typeof vi.spyOn>
let consoleError: ReturnType<typeof vi.spyOn>

function newContext(): AudioContextDoubleInstance {
  return new AudioContext({ sampleRate: 48000 }) as unknown as AudioContextDoubleInstance
}

function sourceOf(context: AudioContextDoubleInstance): AudioNode {
  return context.createMediaStreamSource(new MediaStream()) as unknown as AudioNode
}

async function capture(context: AudioContextDoubleInstance, label = 'The recording'): Promise<AudioCapture> {
  return createAudioCapture(context as unknown as AudioContext, sourceOf(context), { onChunk, label })
}

/** What one encoded chunk was stamped with, and how long it is. */
function stamps(): Array<{ timestamp: number; frames: number; rate: number }> {
  return encoded.map(data => {
    const init = data.init as { timestamp: number; numberOfFrames: number; sampleRate: number }
    return { timestamp: init.timestamp, frames: init.numberOfFrames, rate: init.sampleRate }
  })
}

async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

/** The `{ recycle }` messages the page has sent this node, in order. */
function recycles(node: AudioWorkletNodeDouble): Float32Array[][] {
  return node.port.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message): message is { recycle: Float32Array[] } => typeof message === 'object' && message !== null && 'recycle' in message)
    .map(message => message.recycle)
}

/**
 * The provenance law (ESCSUITE-303): walk every transfer across the port in
 * order and fail if the processor ever posts a buffer the page still holds —
 * one it posted before and has not had back. Returns how many distinct buffers
 * the processor ever posted.
 */
function assertNoBufferPostedWhileInFlight(node: AudioWorkletNodeDouble): number {
  const heldByPage = new Set<number>()
  const posted = new Set<number>()
  for (const { to, ids } of node.transfers) {
    for (const id of ids) {
      if (to === 'page') {
        expect(heldByPage.has(id), `buffer ${id} posted while the page still held it`).toBe(false)
        heldByPage.add(id)
        posted.add(id)
      } else {
        heldByPage.delete(id)
      }
    }
  }
  return posted.size
}

beforeEach(() => {
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  audio = installAudioContextDouble()
  encoded = []
  // What the recorder's encoder does with a chunk: keep it (to inspect) and
  // let the capture close it.
  onChunk = vi.fn((data: AudioData) => {
    encoded.push(data as unknown as FrameDouble)
  })
  consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(URL.createObjectURL).mockClear()
  vi.mocked(URL.revokeObjectURL).mockClear()
})

afterEach(() => {
  uninstallAudioContextDouble()
  uninstallWebCodecsDoubles()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the capture processor (the worklet module)', () => {
  let context: AudioContextDoubleInstance
  let node: AudioWorkletNodeDouble

  beforeEach(async () => {
    enableAudioWorkletDouble({ holdMessages: true })
    context = newContext()
    const url = URL.createObjectURL(new Blob([AUDIO_CAPTURE_WORKLET_SOURCE], { type: 'text/javascript' }))
    await context.audioWorklet!.addModule(url)
    node = new AudioWorkletNode(context as unknown as AudioContext, AUDIO_CAPTURE_PROCESSOR_NAME, {
      channelCount: 2,
      channelCountMode: 'explicit',
    }) as unknown as AudioWorkletNodeDouble
  })

  it(`registers under '${AUDIO_CAPTURE_PROCESSOR_NAME}'`, () => {
    expect(AUDIO_CAPTURE_PROCESSOR_NAME).toBe('escapecraft-capture')
    expect([...context.registeredProcessors.keys()]).toEqual(['escapecraft-capture'])
  })

  it(`posts one chunk per ${CHUNK_FRAMES} frames, stamped with the render position of its first sample`, () => {
    expect(CHUNK_FRAMES).toBe(4096)
    // Start part-way into the context's life: the frame is the context's, not
    // the node's.
    context.renderedFrames = 1280
    context.render(2 * CHUNK_FRAMES + 256, (channel, frame) => channel * 1000 + (frame % 7))

    expect(node.posted).toHaveLength(2)
    const delivered: Array<{ frame: number; channels: Float32Array[] }> = []
    node.port.onmessage = event => delivered.push(event.data as { frame: number; channels: Float32Array[] })
    node.deliver()
    const [first, second] = delivered
    expect(first.frame).toBe(1280)
    expect(second.frame).toBe(1280 + CHUNK_FRAMES)
    expect(first.channels).toHaveLength(2)
    expect(first.channels[0]).toHaveLength(CHUNK_FRAMES)
    expect(first.channels[0][5]).toBe((1280 + 5) % 7)
    expect(first.channels[1][5]).toBe(1000 + ((1280 + 5) % 7))
    expect(second.channels[0][0]).toBe((1280 + CHUNK_FRAMES) % 7)
  })

  it('transfers each chunk\'s buffers rather than copying them', () => {
    context.render(CHUNK_FRAMES)
    const { data, transfer } = node.posted[0]
    const { channels } = data as { channels: Float32Array[] }
    expect(transfer).toEqual(channels.map(c => c.buffer))
    // Detached on the render thread's side — and intact on the page's.
    expect(channels[0].length).toBe(0)
    const delivered: Array<{ channels: Float32Array[] }> = []
    node.port.onmessage = event => delivered.push(event.data as { channels: Float32Array[] })
    node.deliver()
    expect(delivered[0].channels[0]).toHaveLength(CHUNK_FRAMES)
  })

  it('records silence for a quantum whose input has nothing connected', () => {
    context.render(CHUNK_FRAMES, undefined, 0)
    const { channels } = node.posted[0].data as { channels: Float32Array[] }
    expect(channels).toHaveLength(2)
    const delivered: Array<{ channels: Float32Array[] }> = []
    node.port.onmessage = event => delivered.push(event.data as { channels: Float32Array[] })
    node.deliver()
    expect(delivered[0].channels[0].every(v => v === 0)).toBe(true)
    expect(delivered[0].channels[1].every(v => v === 0)).toBe(true)
  })

  it('splits a quantum that straddles a chunk boundary', async () => {
    // Every engine renders 128 frames a quantum today, which divides the
    // chunk; a quantum that does not is split across two chunks rather than
    // overrunning one.
    const { processor } = node as unknown as {
      processor: { process(inputs: Float32Array[][], outputs: Float32Array[][], p: object): boolean }
    }
    const left = new Float32Array(3000).map((_, i) => i)
    const right = new Float32Array(3000).map((_, i) => -i)
    const outputs = [[new Float32Array(3000), new Float32Array(3000)]]
    context.renderingFrame = 0
    processor.process([[left, right]], outputs, {})
    context.renderingFrame = 3000
    processor.process([[left, right]], outputs, {})
    node.port.postMessage('flush')
    await settle()

    const delivered: Array<{ frame: number; channels: Float32Array[] }> = []
    node.port.onmessage = event => delivered.push(event.data as { frame: number; channels: Float32Array[] })
    node.deliver()
    const [first, second] = delivered
    expect(first.frame).toBe(0)
    // Frames 3000..4095 of the first chunk are the second call's first 1096...
    expect(first.channels[0][2999]).toBe(2999)
    expect(first.channels[0][3000]).toBe(0)
    expect(first.channels[0][4095]).toBe(1095)
    expect(first.channels[1][4095]).toBe(-1095)
    // ...and the rest start the next chunk, at the render position of its own
    // first sample.
    expect(second.frame).toBe(4096)
    expect(second.channels[0]).toHaveLength(6000 - 4096)
    expect(second.channels[0][0]).toBe(1096)
  })

  it('takes a silent quantum\'s length from the arrays it is handed, not an assumed 128', async () => {
    // A render quantum other than 128 frames (Chromium's renderSizeHint work)
    // with nothing connected: the length comes from the node's output.
    const { processor } = node as unknown as {
      processor: { process(inputs: Float32Array[][], outputs: Float32Array[][], p: object): boolean }
    }
    const outputs = [[new Float32Array(1024), new Float32Array(1024)]]
    for (let q = 0; q < 4; q++) {
      context.renderingFrame = q * 1024
      processor.process([[]], outputs, {})
    }
    expect(node.posted).toHaveLength(1)
    expect((node.posted[0].data as { frame: number }).frame).toBe(0)
  })

  it("flushes a partial tail on 'flush', then acknowledges and stops processing", async () => {
    context.render(CHUNK_FRAMES + 640)
    node.port.postMessage('flush')
    await settle()

    expect(node.posted.map(p => Object.keys(p.data as object))).toEqual([
      ['frame', 'channels'],
      ['frame', 'channels'],
      ['flushed'],
    ])
    const tail = node.posted[1].data as { frame: number; channels: Float32Array[] }
    expect(tail.frame).toBe(CHUNK_FRAMES)
    expect(node.posted[1].transfer).toHaveLength(2)
    // Sliced to what was rendered, not a 4096-frame chunk padded with zeros.
    const delivered: Array<{ channels?: Float32Array[] }> = []
    node.port.onmessage = event => delivered.push(event.data as { channels?: Float32Array[] })
    node.deliver()
    expect(delivered[1].channels!.map(c => c.length)).toEqual([640, 640])

    // process() returns false from here on, which lets the engine let it go.
    context.render(CHUNK_FRAMES)
    expect(node.finished).toBe(true)
    expect(node.posted).toHaveLength(3)
  })

  it("acknowledges a 'flush' with nothing buffered without posting an empty chunk", async () => {
    context.render(CHUNK_FRAMES)
    node.port.postMessage('flush')
    await settle()
    expect(node.posted.map(p => Object.keys(p.data as object))).toEqual([
      ['frame', 'channels'],
      ['flushed'],
    ])
  })

  describe('its buffer pool (ESCSUITE-303)', () => {
    /** Be the page: take every chunk delivered and hand its buffers straight back. */
    function returnChunks(): void {
      node.port.onmessage = event => {
        const { channels } = event.data as { channels?: Float32Array[] }
        if (channels) node.port.postMessage({ recycle: channels }, channels.map(c => c.buffer))
      }
      node.deliver()
    }

    /** A pair of buffers, as a page would hand back. */
    const pair = (frames = CHUNK_FRAMES) => [new Float32Array(frames), new Float32Array(frames)]

    /** Hand the processor `pairs` directly, as recycles. */
    async function recycle(...pairs: Float32Array[][]): Promise<void> {
      for (const channels of pairs) node.port.postMessage({ recycle: channels }, channels.map(c => c.buffer))
      await settle()
    }

    /** The lineage ids of the buffers in the `n`th transfer the page sent. */
    const idsSent = (n: number) => node.transfers.filter(t => t.to === 'processor')[n].ids
    /** The lineage ids of the buffers in the processor's `n`th chunk. */
    const idsPosted = (n: number) => node.transfers.filter(t => t.to === 'page')[n].ids

    it(`holds at most POOL_PAIRS = 4 pairs`, () => {
      expect(POOL_PAIRS).toBe(4)
    })

    it('fills the next chunk from a recycled pair instead of allocating one', async () => {
      context.render(CHUNK_FRAMES)
      expect(context.processorArrayAllocations).toBe(2)
      returnChunks()
      await settle()

      context.render(CHUNK_FRAMES, (channel, frame) => channel * 1000 + (frame % 5))
      expect(context.processorArrayAllocations).toBe(2)
      // The second chunk went out in the first chunk's buffers...
      expect(idsPosted(1)).toEqual(idsPosted(0))
      // ...overwritten with its own samples.
      const delivered: Array<{ channels: Float32Array[] }> = []
      node.port.onmessage = event => delivered.push(event.data as { channels: Float32Array[] })
      node.deliver()
      expect(delivered[0].channels[0][3]).toBe((CHUNK_FRAMES + 3) % 5)
      expect(delivered[0].channels[1][3]).toBe(1000 + ((CHUNK_FRAMES + 3) % 5))
    })

    it('writes silence over a recycled pair: a quantum with nothing connected leaves no old samples behind', async () => {
      context.render(CHUNK_FRAMES, () => 0.5)
      returnChunks()
      await settle()

      context.render(CHUNK_FRAMES, undefined, 0)
      // Recycled, not fresh — so the zeros were written, not inherited.
      expect(context.processorArrayAllocations).toBe(2)
      const delivered: Array<{ channels: Float32Array[] }> = []
      node.port.onmessage = event => delivered.push(event.data as { channels: Float32Array[] })
      node.deliver()
      expect(delivered[0].channels[0].every(v => v === 0)).toBe(true)
      expect(delivered[0].channels[1].every(v => v === 0)).toBe(true)
    })

    it(`keeps POOL_PAIRS pairs and drops a fifth`, async () => {
      await recycle(pair(), pair(), pair(), pair(), pair())
      const kept = [0, 1, 2, 3].flatMap(idsSent)
      const fifth = idsSent(4)

      context.render(POOL_PAIRS * CHUNK_FRAMES)
      // The four kept pairs carry the next four chunks, with no allocation...
      expect(context.processorArrayAllocations).toBe(0)
      expect([0, 1, 2, 3].flatMap(idsPosted).sort()).toEqual(kept.sort())
      // ...and the chunk after them needs a fresh pair: the fifth was dropped.
      context.render(CHUNK_FRAMES)
      expect(context.processorArrayAllocations).toBe(2)
      expect(idsPosted(4)).not.toEqual(fifth)
      expect(node.transfers.filter(t => t.to === 'page').flatMap(t => t.ids)).not.toContain(fifth[0])
    })

    it('drops a recycled pair that is not CHUNK_FRAMES long, and allocates instead', async () => {
      // A tail, say — sliced to what was rendered.
      await recycle(pair(640))
      context.render(CHUNK_FRAMES)
      expect(context.processorArrayAllocations).toBe(2)
      expect(idsPosted(0)).not.toEqual(idsSent(0))
      expect(node.posted).toHaveLength(1)
    })
  })
})

describe('createAudioCapture: which path a take gets', () => {
  it('loads the processor as a text/javascript Blob URL, revoked once addModule settles, and uses it', async () => {
    enableAudioWorkletDouble()
    const context = newContext()
    await capture(context)

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/javascript')
    expect(await blob.text()).toBe(AUDIO_CAPTURE_WORKLET_SOURCE)
    expect(context.audioWorklet!.addModule).toHaveBeenCalledWith('blob:mock-url')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    expect(context.workletNodes).toHaveLength(1)
    expect(context.scriptProcessors).toHaveLength(0)
  })

  it('does not revoke the module URL before addModule has settled', async () => {
    let open!: () => void
    enableAudioWorkletDouble({ addModuleGate: new Promise<void>(resolve => (open = resolve)) })
    const context = newContext()
    const pending = capture(context)
    await settle()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    open()
    await pending
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('wires the node between the source and the destination, two channels explicit', async () => {
    enableAudioWorkletDouble()
    const context = newContext()
    const source = sourceOf(context) as unknown as { connect: ReturnType<typeof vi.fn> }
    await createAudioCapture(context as unknown as AudioContext, source as unknown as AudioNode, {
      onChunk,
      label: 'The recording',
    })
    const [node] = context.workletNodes
    expect(node.name).toBe('escapecraft-capture')
    expect(node.options).toMatchObject({ channelCount: 2, channelCountMode: 'explicit' })
    expect(source.connect).toHaveBeenCalledWith(node)
    expect(node.connect).toHaveBeenCalledWith(context.destination)
  })

  it('decides once per context and says so once: three captures, one addModule, one line', async () => {
    enableAudioWorkletDouble()
    const context = newContext()
    await capture(context)
    await capture(context, 'Microphone')
    await capture(context, 'System audio')

    expect(context.audioWorklet!.addModule).toHaveBeenCalledTimes(1)
    expect(context.workletNodes).toHaveLength(3)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toMatch(/AudioWorklet/)

    // A new context — a new take — decides again.
    await capture(newContext())
    expect(consoleInfo).toHaveBeenCalledTimes(2)
  })

  it('falls back to a ScriptProcessorNode when the browser has no AudioWorklet', async () => {
    const context = newContext()
    await capture(context)

    expect(context.scriptProcessors).toHaveLength(1)
    expect(context.scriptProcessors[0].bufferSize).toBe(4096)
    expect(context.scriptProcessors[0].connect).toHaveBeenCalledWith(context.destination)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toMatch(/ScriptProcessorNode/)
  })

  it('falls back to a ScriptProcessorNode when addModule rejects, and still revokes the URL', async () => {
    const refusal = new DOMException('blob: modules are not allowed here', 'AbortError')
    enableAudioWorkletDouble({ addModuleError: refusal })
    const context = newContext()
    await capture(context)
    await capture(context, 'Microphone')

    expect(context.workletNodes).toHaveLength(0)
    expect(context.scriptProcessors).toHaveLength(2)
    expect(context.audioWorklet!.addModule).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toMatch(/ScriptProcessorNode/)
    const refused = String(consoleInfo.mock.calls[0][0])
    expect(refused).toContain('blob: AbortError')
    expect(refused).toContain('data: AbortError')
  })
})

describe('createAudioCapture: the data: retry (ESCSUITE-317)', () => {
  const dataPrefix = 'data:text/javascript;charset=utf-8,'

  it('loads the blob: module when it works: one call, "blob module"', async () => {
    enableAudioWorkletDouble()
    const context = newContext()
    await capture(context)

    expect(context.audioWorklet!.addModule).toHaveBeenCalledTimes(1)
    expect(context.workletNodes).toHaveLength(1)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toBe('Recording audio through an AudioWorklet (blob module)')
  })

  it('retries with a data: module when the blob: one is refused, and uses the worklet', async () => {
    enableAudioWorkletDouble({ blobModulesRefused: true })
    const context = newContext()
    await capture(context)
    await capture(context, 'Microphone')

    const addModule = context.audioWorklet!.addModule
    expect(addModule).toHaveBeenCalledTimes(2)
    expect(String(addModule.mock.calls[0][0])).toMatch(/^blob:/)
    const retried = String(addModule.mock.calls[1][0])
    expect(retried.startsWith(dataPrefix)).toBe(true)
    expect(decodeURIComponent(retried.slice(dataPrefix.length))).toBe(AUDIO_CAPTURE_WORKLET_SOURCE)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(context.workletNodes).toHaveLength(2)
    expect(context.scriptProcessors).toHaveLength(0)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toBe('Recording audio through an AudioWorklet (data module)')
  })

  it('falls back to a ScriptProcessorNode when both are refused, naming the data: rejection', async () => {
    enableAudioWorkletDouble({ blobModulesRefused: true, dataModulesRefused: true })
    const context = newContext()
    await capture(context)

    expect(context.audioWorklet!.addModule).toHaveBeenCalledTimes(2)
    expect(context.workletNodes).toHaveLength(0)
    expect(context.scriptProcessors).toHaveLength(1)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toMatch(/ScriptProcessorNode/)
    const line = String(consoleInfo.mock.calls[0][0])
    expect(line).toContain('blob: AbortError: Failed to load worklet module script: blob:')
    expect(line).toContain('data: AbortError: Failed to load worklet module script: data:text/javascript;charset=utf-8,…')
    expect(line).not.toContain(encodeURIComponent(AUDIO_CAPTURE_WORKLET_SOURCE.slice(0, 40)))
    expect(consoleInfo.mock.calls[0]).toHaveLength(1)
  })

  it('reads an Error rejection by its name and message in the fallback line (a real browser rejects with a DOMException, which is an Error there)', async () => {
    // jsdom's DOMException is not an `instanceof Error` in the test realm, so the
    // double's refusals above reach `describeRefusal`'s String arm; a browser's
    // AbortError reaches its Error arm, which this case drives with a plain Error.
    enableAudioWorkletDouble({
      addModuleError: Object.assign(new Error('Failed to load worklet module script: blob:null/0f3a'), { name: 'AbortError' }),
    })
    const context = newContext()
    await capture(context)

    expect(context.audioWorklet!.addModule).toHaveBeenCalledTimes(2)
    expect(context.scriptProcessors).toHaveLength(1)
    const line = String(consoleInfo.mock.calls[0][0])
    expect(line).toContain('blob: AbortError: Failed to load worklet module script: blob:null/0f3a')
    expect(line).toContain('data: AbortError: Failed to load worklet module script: blob:null/0f3a')
    expect(consoleInfo.mock.calls[0]).toHaveLength(1)
  })

  it('makes no addModule call at all when the browser has no AudioWorklet', async () => {
    const context = newContext()
    await capture(context)
    expect(context.audioWorklet).toBeUndefined()
    expect(context.scriptProcessors).toHaveLength(1)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('the AudioWorklet capture', () => {
  let worklet: AudioWorkletDoubleControl
  let context: AudioContextDoubleInstance
  let node: AudioWorkletNodeDouble
  let take: AudioCapture

  async function build(rate = 48000): Promise<void> {
    audio.contextSampleRate = rate
    context = newContext()
    take = await capture(context)
    node = context.workletNodes[0]
  }

  beforeEach(() => {
    worklet = enableAudioWorkletDouble()
  })

  it('keeps only what was rendered from start() on: the chunk in progress is cut there and stamped 0', async () => {
    await build()
    context.render(CHUNK_FRAMES * 2 + 512)
    await settle()
    expect(onChunk).not.toHaveBeenCalled()

    // start() lands mid-chunk: that chunk began before the take did.
    take.start()
    const startFrame = context.renderedFrames
    context.render(CHUNK_FRAMES * 3)
    await settle()

    const us = (frames: number) => Math.round((frames / 48000) * 1e6)
    expect(stamps()).toEqual([
      { timestamp: 0, frames: 3 * CHUNK_FRAMES - startFrame, rate: 48000 },
      { timestamp: us(3 * CHUNK_FRAMES - startFrame), frames: CHUNK_FRAMES, rate: 48000 },
      { timestamp: us(4 * CHUNK_FRAMES - startFrame), frames: CHUNK_FRAMES, rate: 48000 },
    ])
    // The piece is the chunk's own samples from start() on, not its head.
    const first = encoded[0].init as { data: Float32Array }
    expect(first.data).toHaveLength(2 * (3 * CHUNK_FRAMES - startFrame))
    expect(getCreatedFrames('AudioData').every(d => d.closed)).toBe(true)
  })

  it('carries the planar samples, two channels, in f32-planar', async () => {
    await build()
    take.start()
    context.render(CHUNK_FRAMES, (channel, frame) => (channel ? -1 : 1) * (frame % 3))
    await settle()

    const init = encoded[0].init as { format: string; numberOfChannels: number; data: Float32Array }
    expect(init.format).toBe('f32-planar')
    expect(init.numberOfChannels).toBe(2)
    expect(init.data).toHaveLength(2 * CHUNK_FRAMES)
    expect(Array.from(init.data.subarray(0, 4))).toEqual([0, 1, 2, 0])
    expect(Array.from(init.data.subarray(CHUNK_FRAMES, CHUNK_FRAMES + 4))).toEqual([-0, -1, -2, -0])
  })

  it('stamps at the context\'s own rate: 44.1 kHz chunks carry 44100 and frame / 44100', async () => {
    await build(44100)
    take.start()
    context.render(CHUNK_FRAMES * 3)
    await settle()

    expect(stamps().map(s => s.rate)).toEqual([44100, 44100, 44100])
    expect(stamps().map(s => s.timestamp)).toEqual([0, 1, 2].map(k => Math.round(((k * CHUNK_FRAMES) / 44100) * 1e6)))
  })

  it('decides by render position, not arrival: a late chunk is kept, and stamped where it was rendered', async () => {
    await build()
    worklet.holdMessages = true
    take.start()
    context.render(CHUNK_FRAMES * 4)
    take.pause()
    // Everything rendered before the pause arrives after it — and after the
    // resume too. None of it is lost, and none of it is the pause.
    context.render(CHUNK_FRAMES * 2)
    take.resume()
    context.render(CHUNK_FRAMES)
    node.deliver()

    expect(stamps().map(s => s.timestamp)).toEqual(
      [0, 1, 2, 3, 4].map(k => Math.round(((k * CHUNK_FRAMES) / 48000) * 1e6))
    )
  })

  it('drops what was rendered while paused, to the frame: stamps run on across the pause with no gap and no overlap', async () => {
    await build()
    take.start()
    context.render(CHUNK_FRAMES * 2 + 1024)
    take.pause()
    context.render(CHUNK_FRAMES * 5)
    take.resume()
    context.render(CHUNK_FRAMES * 3)
    await settle()

    const C = CHUNK_FRAMES
    // Two whole chunks; the one the pause landed in, cut at the pause; the
    // paused ones gone; the one the resume landed in, from the resume on.
    expect(stamps().map(s => s.frames)).toEqual([C, C, 1024, C - 1024, C, C])
    expect(stamps().map(s => s.timestamp)).toEqual(
      [0, C, 2 * C, 2 * C + 1024, 3 * C, 4 * C].map(f => Math.round((f / 48000) * 1e6))
    )
    // The piece after the resume is the chunk's own samples from the resume
    // on — the frames rendered before it were the pause.
    const resumed = encoded[3].init as { data: Float32Array }
    expect(resumed.data).toHaveLength(2 * (C - 1024))
  })

  it('a pause and a resume inside one chunk cut it into two pieces, back to back', async () => {
    await build()
    take.start()
    context.render(1024)
    take.pause()
    context.render(512)
    take.resume()
    context.render(CHUNK_FRAMES - 1536)
    await settle()

    expect(stamps().map(s => s.frames)).toEqual([1024, CHUNK_FRAMES - 1536])
    expect(stamps().map(s => s.timestamp)).toEqual([0, Math.round((1024 / 48000) * 1e6)])
  })

  it('subtracts every pause: two pauses, the second span offset by both recorded spans before it', async () => {
    await build()
    take.start()
    context.render(CHUNK_FRAMES * 2)
    take.pause()
    context.render(CHUNK_FRAMES * 3)
    take.resume()
    context.render(CHUNK_FRAMES * 2)
    take.pause()
    context.render(CHUNK_FRAMES * 7)
    take.resume()
    context.render(CHUNK_FRAMES * 2)
    await settle()

    expect(stamps().map(s => s.timestamp)).toEqual(
      [0, 1, 2, 3, 4, 5].map(k => Math.round(((k * CHUNK_FRAMES) / 48000) * 1e6))
    )
  })

  it('stop() flushes the tail, waits for it, and closes the node and its port', async () => {
    await build()
    take.start()
    context.render(CHUNK_FRAMES + 1024)
    await take.stop()

    expect(node.port.postMessage).toHaveBeenCalledWith('flush')
    expect(stamps().map(s => s.frames)).toEqual([CHUNK_FRAMES, 1024])
    expect(node.disconnect).toHaveBeenCalledTimes(1)
    expect(node.port.close).toHaveBeenCalledTimes(1)
    expect(node.port.onmessage).toBeNull()
  })

  it('stop() cuts the tail at the render position it was called at, not where the flush was handled', async () => {
    await build()
    take.start()
    context.render(CHUNK_FRAMES + 1024)
    const stopped = take.stop()
    // The render thread goes on rendering until it handles the flush: those
    // frames are after the end of the take.
    context.render(512)
    await stopped

    expect(stamps().map(s => s.frames)).toEqual([CHUNK_FRAMES, 1024])
  })

  it('stop() while paused takes nothing rendered after the pause', async () => {
    await build()
    take.start()
    context.render(CHUNK_FRAMES + 1024)
    take.pause()
    context.render(768)
    const stopped = take.stop()
    context.render(512)
    await stopped

    expect(stamps().map(s => s.frames)).toEqual([CHUNK_FRAMES, 1024])
  })

  it('stop() before start() takes nothing and still lets the node go', async () => {
    await build()
    context.render(CHUNK_FRAMES + 1024)
    await take.stop()
    expect(onChunk).not.toHaveBeenCalled()
    expect(node.disconnect).toHaveBeenCalledTimes(1)
  })

  it('stop() waits for chunks still queued behind a busy page, tail and all', async () => {
    await build()
    worklet.holdMessages = true
    take.start()
    context.render(CHUNK_FRAMES * 3 + 256)
    const stopped = take.stop()
    await settle()
    // The flush went out, the tail and the acknowledgement are queued behind
    // the three chunks the page has not got to yet.
    let done = false
    void stopped.then(() => (done = true))
    await settle()
    expect(done).toBe(false)
    node.deliver()
    await stopped
    expect(stamps().map(s => s.frames)).toEqual([CHUNK_FRAMES, CHUNK_FRAMES, CHUNK_FRAMES, 256])
  })

  it('ignores a chunk that arrives after stop()', async () => {
    await build()
    take.start()
    context.render(CHUNK_FRAMES)
    await take.stop()
    const before = onChunk.mock.calls.length

    // Whatever else the render thread produces now never reaches the encoder.
    context.render(CHUNK_FRAMES * 2)
    node.deliver()
    await settle()
    expect(onChunk).toHaveBeenCalledTimes(before)
  })

  it('stop() is one stop: a second call is the same promise, and the flush is posted once', async () => {
    await build()
    take.start()
    const first = take.stop()
    expect(take.stop()).toBe(first)
    await first
    expect(node.port.postMessage).toHaveBeenCalledTimes(1)
  })

  it(`gives up on a render thread that never answers after ${FLUSH_TIMEOUT_MS} ms, says so, and closes`, async () => {
    vi.useFakeTimers()
    await build()
    worklet.processorDeaf = true
    take.start()
    context.render(CHUNK_FRAMES + 512)
    const stopped = take.stop()
    let done = false
    void stopped.then(() => (done = true))

    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(String(consoleWarn.mock.calls[0][0])).toContain('The recording')
    expect(node.disconnect).toHaveBeenCalledTimes(1)
    // The whole chunk it did send was kept; only the unflushed tail is lost.
    expect(stamps().map(s => s.frames)).toEqual([CHUNK_FRAMES])
  })

  it('does not leave the flush timer behind once the tail has arrived', async () => {
    vi.useFakeTimers()
    await build()
    take.start()
    await take.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('close() during a pending stop() settles it — a take disposed mid-stop does not hang', async () => {
    await build()
    worklet.processorDeaf = true
    take.start()
    const stopped = take.stop()
    take.close()
    await expect(stopped).resolves.toBeUndefined()
    expect(node.disconnect).toHaveBeenCalledTimes(1)
  })

  it('close() is idempotent, and a stop() after it resolves at once without posting', async () => {
    await build()
    take.close()
    take.close()
    expect(node.disconnect).toHaveBeenCalledTimes(1)
    expect(node.port.close).toHaveBeenCalledTimes(1)
    await take.stop()
    expect(node.port.postMessage).not.toHaveBeenCalled()
  })

  it('logs an encode that throws, closes its AudioData, and keeps going', async () => {
    await build()
    onChunk.mockImplementationOnce(() => {
      throw new Error('encoder closed')
    })
    take.start()
    context.render(CHUNK_FRAMES * 2)
    await settle()

    expect(consoleError).toHaveBeenCalledWith('Audio encoding error:', expect.any(Error))
    expect(getCreatedFrames('AudioData')).toHaveLength(2)
    expect(getCreatedFrames('AudioData').every(d => d.closed)).toBe(true)
    expect(encoded).toHaveLength(1)
  })
})

describe('the AudioWorklet capture hands each chunk\'s buffers back (ESCSUITE-303)', () => {
  let worklet: AudioWorkletDoubleControl
  let context: AudioContextDoubleInstance
  let node: AudioWorkletNodeDouble
  let take: AudioCapture

  beforeEach(async () => {
    worklet = enableAudioWorkletDouble()
    context = newContext()
    take = await capture(context)
    node = context.workletNodes[0]
  })

  /** Render `chunks` while the page is busy, then let it catch up. */
  async function behind(chunks: number): Promise<void> {
    worklet.holdMessages = true
    context.render(chunks * CHUNK_FRAMES)
    worklet.holdMessages = false
    node.deliver()
    await settle()
  }

  it('recycles every chunk it handles, after encoding it, transferred', async () => {
    take.start()
    context.render(CHUNK_FRAMES * 2)
    await settle()

    expect(stamps().map(s => s.frames)).toEqual([CHUNK_FRAMES, CHUNK_FRAMES])
    const sent = recycles(node)
    expect(sent).toHaveLength(2)
    const [[channels, transfer]] = node.port.postMessage.mock.calls as unknown as Array<[{ recycle: Float32Array[] }, ArrayBuffer[]]>
    expect(transfer).toHaveLength(2)
    expect(transfer).toEqual(channels.recycle.map(c => c.buffer))
    // Detached on the page's side: it keeps nothing it handed back.
    expect(sent[0][0].length).toBe(0)
  })

  it('recycles a chunk that kept nothing — rendered while paused, or after stop() — since the node lives until close()', async () => {
    take.start()
    context.render(CHUNK_FRAMES)
    take.pause()
    context.render(CHUNK_FRAMES)
    await settle()
    expect(encoded).toHaveLength(1)
    expect(recycles(node)).toHaveLength(2)

    take.resume()
    context.render(CHUNK_FRAMES)
    const stopped = take.stop()
    // Rendered after the take ended, before the render thread got the flush.
    context.render(CHUNK_FRAMES)
    await stopped
    expect(encoded).toHaveLength(2)
    expect(recycles(node)).toHaveLength(4)
  })

  it('never recycles after close(): a chunk whose encode closes the capture is not handed back, and nothing throws', async () => {
    onChunk.mockImplementationOnce(() => take.close())
    take.start()
    context.render(CHUNK_FRAMES)
    await settle()

    expect(node.port.close).toHaveBeenCalledTimes(1)
    expect(recycles(node)).toHaveLength(0)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it(`a 20-chunk take allocates buffers for the first POOL_PAIRS + 1 chunks and then none, and never posts a buffer the page still holds`, async () => {
    take.start()
    // The page falls one chunk further behind than the pool holds: five pairs
    // are made, five come back, and the pool keeps four.
    await behind(POOL_PAIRS + 1)
    for (let k = POOL_PAIRS + 1; k < 20; k++) await behind(1)

    expect(encoded).toHaveLength(20)
    expect(stamps().map(s => s.timestamp)).toEqual(
      Array.from({ length: 20 }, (_, k) => Math.round(((k * CHUNK_FRAMES) / 48000) * 1e6))
    )
    // Exact: two buffers for each of the first five chunks, none after.
    expect(context.processorArrayAllocations).toBe(2 * (POOL_PAIRS + 1))
    expect(assertNoBufferPostedWhileInFlight(node)).toBe(2 * (POOL_PAIRS + 1))
  })

  // ESCSUITE-303, measured 2026-10-16: the render thread's allocations per
  // chunk once the pool is warm, with the page up to POOL_PAIRS chunks behind.
  // Before the pool it was 2 per chunk (two fresh Float32Array(4096), ~32 KB,
  // every ~85 ms); it is 0, and a conservation law, so asserted exactly.
  it('allocates nothing per chunk after warm-up while the page is no more than POOL_PAIRS chunks behind', async () => {
    take.start()
    await behind(POOL_PAIRS + 1)
    const warm = context.processorArrayAllocations

    const lags = [1, 2, 3, 4, 4, 3, 2, 1]
    let chunks = 0
    for (let round = 0; chunks < 100; round++) {
      const lag = Math.min(lags[round % lags.length], 100 - chunks)
      await behind(lag)
      chunks += lag
    }

    expect(encoded).toHaveLength(POOL_PAIRS + 1 + 100)
    expect((context.processorArrayAllocations - warm) / chunks).toBe(0)
    assertNoBufferPostedWhileInFlight(node)
  })
})

describe('the ScriptProcessorNode capture (the fallback)', () => {
  let context: AudioContextDoubleInstance
  let take: AudioCapture

  beforeEach(async () => {
    context = newContext()
    take = await capture(context)
  })

  const fire = (playbackTime?: number) =>
    context.scriptProcessors[0].onaudioprocess!({
      inputBuffer: createAudioBufferDouble({ length: 4096, sample: () => 0.25 }),
      ...(playbackTime === undefined ? {} : { playbackTime }),
    })

  it('encodes nothing before start() or while paused, and counts on from where it was after a resume', () => {
    fire()
    expect(onChunk).not.toHaveBeenCalled()
    take.start()
    fire()
    take.pause()
    fire()
    take.resume()
    fire()
    expect(stamps().map(s => s.timestamp)).toEqual([0, (4096 / 48000) * 1e6])
  })

  it('keeps ESCSUITE-296\'s gap filler: a callback the page never saw is filled with silence', () => {
    take.start()
    const bufferSeconds = 4096 / 48000
    // A long first window, then one callback lost, then another window.
    for (let k = 0; k < 120; k++) if (k !== 60) fire(1000 + k * bufferSeconds)

    const silence = encoded.filter(d => (d.source as Float32Array).every(v => v === 0))
    expect(silence.length).toBeGreaterThan(0)
    expect(silence.reduce((n, d) => n + (d.init as { numberOfFrames: number }).numberOfFrames, 0)).toBe(4096 - 128)
  })

  it('stop() disconnects the node once and stops encoding; close() after it does nothing more', async () => {
    take.start()
    await take.stop()
    fire()
    take.close()
    expect(onChunk).not.toHaveBeenCalled()
    expect(context.scriptProcessors[0].disconnect).toHaveBeenCalledTimes(1)
  })

  it('a capture stopped before the take started is not revived by start() or resume()', () => {
    void take.stop()
    take.start()
    fire()
    take.pause()
    take.resume()
    fire()
    expect(onChunk).not.toHaveBeenCalled()
  })

  it('logs an encode that throws and closes its AudioData', () => {
    onChunk.mockImplementationOnce(() => {
      throw new Error('encoder closed')
    })
    take.start()
    fire()
    expect(consoleError).toHaveBeenCalledWith('Audio encoding error:', expect.any(Error))
    expect(getCreatedFrames('AudioData').every(d => d.closed)).toBe(true)
  })
})
