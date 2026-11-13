// ESCSUITE-404: "Transcribe to captions". The recogniser is only ever created
// on device, it hears the timeline's mix through a MediaStreamTrack (never the
// microphone), and what it says becomes ordinary caption cues.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  END_WAIT_MS,
  HEARD_LEAD_SECONDS,
  MAX_CUE_CHARS,
  TranscriptionError,
  createLocalRecognition,
  cuesFromSegments,
  describeRecognitionError,
  splitCueText,
  TRANSCRIBE_MAX_SECONDS,
  TRANSCRIBE_TOO_LONG_MESSAGE,
  transcribeChannels,
  transcribeTimeline,
  type TranscribeAudioContext,
} from './transcribe';
import { makeClip, makeTrack } from '../test/fixtures/clipFixtures';
import type {
  SpeechErrorEventLike,
  SpeechRecognitionCtor,
  SpeechRecognitionLike,
  SpeechResultEventLike,
} from './speechRecognitionLocal';

vi.mock('./audioMixer', () => ({ extractSpeechMix: vi.fn(), SPEECH_MIX_SAMPLE_RATE: 16000 }));
import { extractSpeechMix } from './audioMixer';

// --- Doubles -----------------------------------------------------------------

interface StartCall {
  track: MediaStreamTrack | undefined;
  processLocally: boolean | undefined;
}

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  /** When false, the "browser" drops processLocally (a recogniser that would send audio away). */
  static keepsProcessLocally = true;
  lang = '';
  continuous = false;
  interimResults = false;
  private local: boolean | undefined = undefined;
  onresult: ((event: SpeechResultEventLike) => void) | null = null;
  onerror: ((event: SpeechErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  starts: StartCall[] = [];
  stop = vi.fn(() => {
    queueMicrotask(() => this.onend?.());
  });
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  get processLocally() {
    return this.local;
  }
  set processLocally(value: boolean | undefined) {
    if (FakeRecognition.keepsProcessLocally) this.local = value;
  }
  start(track?: MediaStreamTrack) {
    this.starts.push({ track, processLocally: this.processLocally });
  }
  say(index: number, transcript: string, isFinal: boolean) {
    const results: SpeechResultEventLike['results'] = Object.assign([] as unknown[], {
      [index]: Object.assign([{ transcript }], { isFinal }),
      length: index + 1,
    }) as unknown as SpeechResultEventLike['results'];
    this.onresult?.({ resultIndex: index, results });
  }
}
const Recognition = FakeRecognition as unknown as SpeechRecognitionCtor;

function makeContext() {
  const track = { kind: 'audio', readyState: 'live' } as unknown as MediaStreamTrack;
  const source = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const buffer = { copyToChannel: vi.fn() };
  const ctx = {
    currentTime: 0,
    createBuffer: vi.fn(() => buffer as unknown as AudioBuffer),
    createBufferSource: vi.fn(() => source as unknown as AudioBufferSourceNode),
    createMediaStreamDestination: vi.fn(
      () => ({ stream: { getAudioTracks: () => [track] } }) as unknown as MediaStreamAudioDestinationNode
    ),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  return { ctx: ctx as typeof ctx & TranscribeAudioContext, source, buffer, track };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.keepsProcessLocally = true;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- The recogniser -----------------------------------------------------------

describe('createLocalRecognition (ESCSUITE-404)', () => {
  it('creates the recogniser on device only, continuous with interim results', () => {
    const recognition = createLocalRecognition(Recognition, 'en-GB');
    expect(recognition.processLocally).toBe(true);
    expect(recognition.lang).toBe('en-GB');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
  });

  it('refuses a recogniser that does not keep processLocally, so nothing could go off the device', () => {
    FakeRecognition.keepsProcessLocally = false;
    expect(() => createLocalRecognition(Recognition, 'en-US')).toThrow(TranscriptionError);
    expect(FakeRecognition.instances[0].starts).toHaveLength(0);
  });
});

// --- Words into cues ----------------------------------------------------------

describe('cuesFromSegments', () => {
  it('starts a cue just before its words were first heard and ends it when they were settled', () => {
    expect(cuesFromSegments([{ text: 'hello there', heardAt: 1.5, finalAt: 3.2 }], 10)).toEqual([
      { start: 1.5 - HEARD_LEAD_SECONDS, end: 3.2, text: 'hello there' },
    ]);
  });

  it('keeps cues in order and apart, at least a second long and inside the timeline', () => {
    const cues = cuesFromSegments(
      [
        { text: 'second', heardAt: 2.1, finalAt: 2.2 },
        { text: 'first', heardAt: 0.1, finalAt: 2.15 },
        { text: '   ', heardAt: 3, finalAt: 4 },
        { text: 'last', heardAt: 9.8, finalAt: 10.5 },
      ],
      10
    );
    expect(cues.map((c) => c.text)).toEqual(['first', 'second', 'last']);
    expect(cues[0]).toEqual({ start: 0, end: 2.15, text: 'first' });
    expect(cues[1]).toEqual({ start: 2.15, end: 3.15, text: 'second' });
    expect(cues[2]).toEqual({ start: 9, end: 10, text: 'last' });
  });

  it('joins words that land with no room left onto the cue before', () => {
    const cues = cuesFromSegments(
      [
        { text: 'one', heardAt: 0, finalAt: 2 },
        { text: 'two', heardAt: 2, finalAt: 2 },
      ],
      2
    );
    expect(cues).toEqual([{ start: 0, end: 2, text: 'one two' }]);
    expect(cuesFromSegments([{ text: 'lost', heardAt: 0, finalAt: 0 }], 0)).toEqual([]);
  });

  it('splits a long result into caption-sized cues, sharing its time out by length', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const cues = cuesFromSegments([{ text: words, heardAt: 0.3, finalAt: 12 }], 20);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((c) => c.text.length <= MAX_CUE_CHARS)).toBe(true);
    expect(cues.map((c) => c.text).join(' ')).toBe(words);
    expect(cues[0].start).toBe(0);
    expect(cues[cues.length - 1].end).toBe(12);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBe(cues[i - 1].end);
  });
});

describe('splitCueText', () => {
  it('cuts at word boundaries and leaves an over-long word whole', () => {
    expect(splitCueText('aa bb cc', 5)).toEqual(['aa bb', 'cc']);
    expect(splitCueText('abcdefgh ij', 5)).toEqual(['abcdefgh', 'ij']);
    expect(splitCueText('  ')).toEqual([]);
  });
});

describe('describeRecognitionError', () => {
  it('names the errors a user can do something about', () => {
    expect(describeRecognitionError('language-not-supported')).toMatch(/language pack/);
    expect(describeRecognitionError('not-allowed')).toMatch(/did not allow/);
    expect(describeRecognitionError('service-not-allowed')).toMatch(/did not allow/);
    expect(describeRecognitionError('audio-capture')).toBe('On-device speech recognition stopped (audio-capture).');
  });
});

// --- The whole run ------------------------------------------------------------

const TEN_SECONDS = [new Float32Array(480_000), new Float32Array(480_000)];

describe('transcribeChannels (ESCSUITE-404)', () => {
  it('plays the mix into a stream track, hands that track to an on-device recogniser and returns its words as cues', async () => {
    const { ctx, source, buffer, track } = makeContext();
    const progress = vi.fn();
    const run = transcribeChannels({
      channels: TEN_SECONDS,
      sampleRate: 48000,
      lang: 'en-US',
      Recognition,
      createAudioContext: () => ctx,
      onProgress: progress,
    });
    await flush();

    const [recognition] = FakeRecognition.instances;
    expect(FakeRecognition.instances).toHaveLength(1);
    // The track, never the microphone; on device at the moment it starts.
    expect(recognition.starts).toEqual([{ track, processLocally: true }]);
    expect(ctx.createBuffer).toHaveBeenCalledWith(2, 480_000, 48000);
    expect(buffer.copyToChannel).toHaveBeenCalledTimes(2);
    expect(source.connect).toHaveBeenCalled();
    expect(source.start).toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(0, 10);

    ctx.currentTime = 1;
    recognition.say(0, 'the quick', false);
    ctx.currentTime = 3;
    recognition.say(0, 'the quick brown fox', true);
    ctx.currentTime = 5;
    recognition.say(1, 'jumps over', false);
    ctx.currentTime = 7;
    recognition.say(1, 'jumps over the lazy dog', true);

    ctx.currentTime = 10;
    source.onended?.();
    expect(recognition.stop).toHaveBeenCalled();
    const cues = await run;

    expect(cues).toEqual([
      { start: 0.7, end: 3, text: 'the quick brown fox' },
      { start: 4.7, end: 7, text: 'jumps over the lazy dog' },
    ]);
    expect(progress).toHaveBeenLastCalledWith(10, 10);
    expect(ctx.close).toHaveBeenCalled();
  });

  it('listens again, still on device and on the same track, when the recogniser ends before the sound does', async () => {
    const { ctx, source, track } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    ctx.currentTime = 2;
    recognition.say(0, 'before the pause', true);
    recognition.onerror?.({ error: 'no-speech' });
    recognition.onend?.();
    expect(recognition.starts).toEqual([
      { track, processLocally: true },
      { track, processLocally: true },
    ]);
    ctx.currentTime = 6;
    // A new session counts its results from 0 again.
    recognition.say(0, 'after the pause', true);
    source.onended?.();
    const cues = await run;
    expect(cues.map((c) => c.text)).toEqual(['before the pause', 'after the pause']);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it('keeps what was heard when listening again throws', async () => {
    const { ctx } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    recognition.say(0, 'only this', false);
    recognition.start = () => {
      throw new DOMException('busy', 'InvalidStateError');
    };
    recognition.onend?.();
    await expect(run).resolves.toEqual([{ start: 0, end: 1, text: 'only this' }]);
  });

  it('stops at once and keeps nothing when aborted', async () => {
    const { ctx, source } = makeContext();
    const controller = new AbortController();
    const run = transcribeChannels({
      channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx, signal: controller.signal,
    });
    await flush();
    FakeRecognition.instances[0].say(0, 'half a', false);
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeRecognition.instances[0].abort).toHaveBeenCalled();
    expect(source.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });

  it('rejects an already-aborted signal before creating anything', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('answers no cues for an empty mix without creating a recogniser', async () => {
    await expect(transcribeChannels({ channels: [new Float32Array(0)], sampleRate: 48000, lang: 'en-US', Recognition })).resolves.toEqual([]);
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('fails with the error in words when the recogniser reports one', async () => {
    const { ctx } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    FakeRecognition.instances[0].onerror?.({ error: 'language-not-supported' });
    await expect(run).rejects.toThrow('The speech language pack for this language is not installed on this device.');
  });

  it('refuses to play anything when the recogniser would not stay on device', async () => {
    FakeRecognition.keepsProcessLocally = false;
    const createAudioContext = vi.fn();
    expect(() =>
      transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext })
    ).toThrow(TranscriptionError);
    expect(createAudioContext).not.toHaveBeenCalled();
  });

  it('fails cleanly when the stream has no audio track or the context cannot start', async () => {
    const noTrack = makeContext();
    noTrack.ctx.createMediaStreamDestination.mockReturnValue(
      { stream: { getAudioTracks: () => [] } } as unknown as MediaStreamAudioDestinationNode
    );
    await expect(
      transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => noTrack.ctx })
    ).rejects.toThrow('The browser gave no audio track to transcribe.');

    const broken = makeContext();
    broken.ctx.resume.mockRejectedValue(new Error('no audio device'));
    await expect(
      transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => broken.ctx })
    ).rejects.toThrow('Could not start on-device speech recognition.');
  });

  it('reports progress on the playback clock while it listens', async () => {
    vi.useFakeTimers();
    const { ctx, source } = makeContext();
    const progress = vi.fn();
    const run = transcribeChannels({
      channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx, onProgress: progress,
    });
    await vi.advanceTimersByTimeAsync(0);
    ctx.currentTime = 4;
    await vi.advanceTimersByTimeAsync(250);
    expect(progress).toHaveBeenLastCalledWith(4, 10);
    source.onended?.();
    await vi.advanceTimersByTimeAsync(0);
    await expect(run).resolves.toEqual([]);
  });

  it('reports nothing and stops nothing after it has failed, when the stopped source ends', async () => {
    const { ctx, source } = makeContext();
    const progress = vi.fn();
    // A real source fires `ended` when it is stopped, as cleaning up does.
    source.stop.mockImplementation(() => source.onended?.());
    const run = transcribeChannels({
      channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx, onProgress: progress,
    });
    await flush();
    const [recognition] = FakeRecognition.instances;
    progress.mockClear();
    recognition.onerror?.({ error: 'network' });
    await expect(run).rejects.toThrow('On-device speech recognition stopped (network).');
    expect(source.stop).toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(recognition.stop).not.toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });

  it('drops an interim result the recogniser folded into an earlier one', async () => {
    const { ctx, source } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    const event = (resultIndex: number, results: Array<[string, boolean]>) =>
      recognition.onresult?.({
        resultIndex,
        results: results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) as unknown as SpeechResultEventLike['results'],
      });
    ctx.currentTime = 1;
    event(0, [['hello', false], [' from the', false]]);
    ctx.currentTime = 3;
    event(0, [['hello from the stub', true]]);
    source.onended?.();
    const cues = await run;
    expect(cues.map((c) => c.text)).toEqual(['hello from the stub']);
  });

  it('finishes when stop() itself throws', async () => {
    const { ctx, source } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    recognition.say(0, 'done', true);
    recognition.stop.mockImplementation(() => {
      throw new DOMException('not started', 'InvalidStateError');
    });
    source.onended?.();
    await expect(run).resolves.toEqual([{ start: 0, end: 1, text: 'done' }]);
  });
});

/** A stand-in `AudioBuffer` that records its size and holds `data` as its one channel. */
function fakeBuffer(numberOfChannels: number, length: number, sampleRate: number, data = new Float32Array(0)) {
  return { numberOfChannels, length, sampleRate, duration: length / sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
}

/** The mixer as the real one calls its seam: one plane of the 16 kHz length, then the mix. */
function mixesAtSpeechRate() {
  vi.mocked(extractSpeechMix).mockImplementation(async (_clips, _tracks, duration, allocate) =>
    allocate!(Math.ceil(Math.ceil(duration * 48000) / 3))
  );
}

describe('transcribeTimeline (ESCSUITE-404)', () => {
  beforeEach(() => {
    vi.mocked(extractSpeechMix).mockReset();
  });

  it('is null when the timeline has no sound', async () => {
    vi.mocked(extractSpeechMix).mockResolvedValue(null);
    const phases: string[] = [];
    await expect(
      transcribeTimeline({ clips: [], tracks: [], lang: 'en-US', Recognition, onProgress: (p) => phases.push(p) })
    ).resolves.toBeNull();
    expect(phases).toEqual(['mixing']);
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('stops after mixing when aborted meanwhile', async () => {
    const controller = new AbortController();
    vi.mocked(extractSpeechMix).mockImplementation(async (_c, _t, _d, allocate) => {
      controller.abort();
      return allocate!(160_000);
    });
    await expect(
      transcribeTimeline({
        clips: [],
        tracks: [],
        lang: 'en-US',
        Recognition,
        signal: controller.signal,
        createBuffer: (c, l, r) => fakeBuffer(c, l, r),
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('transcribes the mix the export would make', async () => {
    vi.mocked(extractSpeechMix).mockResolvedValue(null);
    await expect(transcribeTimeline({ clips: [], tracks: [], lang: 'en-US', Recognition })).resolves.toBeNull();
    expect(extractSpeechMix).toHaveBeenLastCalledWith([], [], 0, expect.any(Function), undefined, expect.any(Function));
  });
});

// ESCSUITE-438: Stop is seen while the sound is prepared, preparing shows how
// far it has got, and a recogniser that never ends cannot hold a run open.
describe('transcribeTimeline: preparing and ending (ESCSUITE-438)', () => {
  beforeEach(() => {
    vi.mocked(extractSpeechMix).mockReset();
  });

  it("reports the mix's progress as whole percentages, each once", async () => {
    vi.mocked(extractSpeechMix).mockImplementation(async (_c, _t, _d, _allocate, _signal, onProgress) => {
      for (const percent of [0.4, 12.5, 12.9, 50, 99.99, 100]) onProgress!(percent);
      return null;
    });
    const seen: Array<[string, number, number]> = [];
    await transcribeTimeline({
      clips: [],
      tracks: [],
      lang: 'en-US',
      Recognition,
      onProgress: (phase, done, total) => seen.push([phase, done, total]),
    });
    expect(seen).toEqual([
      ['mixing', 0, 100],
      ['mixing', 12, 100],
      ['mixing', 50, 100],
      ['mixing', 99, 100],
      ['mixing', 100, 100],
    ]);
  });

  it('rejects at once and listens to nothing when stopped while the sound is prepared', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    // A mix that sees its signal between chunks, as the real one does.
    vi.mocked(extractSpeechMix).mockImplementation(
      (_c, _t, _d, _allocate, signal) =>
        new Promise((_, reject) => {
          const chunk = setInterval(() => {
            if (signal?.aborted) {
              clearInterval(chunk);
              reject(new DOMException('Mix stopped', 'AbortError'));
            }
          }, 50);
        })
    );
    const run = transcribeTimeline({ clips: [], tracks: [], lang: 'en-US', Recognition, signal: controller.signal });
    const settled = vi.fn();
    run.then(settled, settled);
    await vi.advanceTimersByTimeAsync(2000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('finishes with what was heard when the recogniser never ends after the sound has played', async () => {
    vi.useFakeTimers();
    mixesAtSpeechRate();
    const { ctx, source } = makeContext();
    const run = transcribeTimeline({
      clips: [makeClip({ duration: 6, endTime: 6 })],
      tracks: [makeTrack()],
      lang: 'en-US',
      Recognition,
      createAudioContext: () => ctx,
      createBuffer: (c, l, r) => fakeBuffer(c, l, r),
    });
    const settled = vi.fn();
    run.then(settled, settled);
    await vi.advanceTimersByTimeAsync(0);
    const [recognition] = FakeRecognition.instances;
    // stop() is asked for, but this recogniser never fires `onend`.
    recognition.stop.mockImplementation(() => {});
    ctx.currentTime = 1;
    recognition.say(0, 'hello from', false);
    ctx.currentTime = 2.5;
    recognition.say(0, 'hello from the stub', true);
    ctx.currentTime = 6;
    source.onended?.();
    expect(recognition.stop).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(END_WAIT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith([{ start: 0.7, end: 2.5, text: 'hello from the stub' }]);
    // The recogniser that never ended is let go, and nothing is left running.
    expect(recognition.abort).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes as soon as the recogniser ends, and leaves no wait behind', async () => {
    vi.useFakeTimers();
    const { ctx, source } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await vi.advanceTimersByTimeAsync(0);
    const [recognition] = FakeRecognition.instances;
    recognition.say(0, 'done', true);
    source.onended?.();
    await expect(run).resolves.toEqual([{ start: 0, end: 1, text: 'done' }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(recognition.abort).not.toHaveBeenCalled();
  });
});

describe('transcribeTimeline: memory and length (ESCSUITE-433)', () => {
  beforeEach(() => {
    vi.mocked(extractSpeechMix).mockReset();
  });

  it('mixes an hour into one 16 kHz channel, the buffer that plays it: under 300 MB, with no copy', async () => {
    mixesAtSpeechRate();
    const allocated: number[] = [];
    let created: AudioBuffer | null = null;
    const { ctx, source } = makeContext();
    const hour = [makeClip({ duration: 3600, endTime: 3600 })];
    const run = transcribeTimeline({
      clips: hour,
      tracks: [makeTrack()],
      lang: 'en-US',
      Recognition,
      createAudioContext: () => ctx,
      createBuffer: (channels, length, rate) => {
        allocated.push(channels * length * Float32Array.BYTES_PER_ELEMENT);
        return (created = fakeBuffer(channels, length, rate));
      },
    });
    await flush();

    // One channel at 16 kHz: 230.4 MB, where the stereo 48 kHz mix and its
    // copy into an AudioBuffer were 2.76 GB.
    expect(allocated).toEqual([3600 * 16000 * 4]);
    expect(allocated.reduce((a, b) => a + b, 0)).toBeLessThan(300 * 1e6);
    // The mix was written straight into the buffer that plays: nothing is copied.
    expect(source.buffer).toBe(created);
    expect(ctx.createBuffer).not.toHaveBeenCalled();
    source.onended?.();
    await expect(run).resolves.toEqual([]);
  });

  it('keeps cue times on the fixture within 50 ms of the 48 kHz stereo run', async () => {
    mixesAtSpeechRate();
    const { ctx, source } = makeContext();
    const run = transcribeTimeline({
      clips: [makeClip({ duration: 10, endTime: 10 })],
      tracks: [makeTrack()],
      lang: 'en-US',
      Recognition,
      createAudioContext: () => ctx,
      createBuffer: (c, l, r) => fakeBuffer(c, l, r),
    });
    await flush();
    const [recognition] = FakeRecognition.instances;
    ctx.currentTime = 1;
    recognition.say(0, 'the quick', false);
    ctx.currentTime = 3;
    recognition.say(0, 'the quick brown fox', true);
    ctx.currentTime = 5;
    recognition.say(1, 'jumps over', false);
    ctx.currentTime = 7;
    recognition.say(1, 'jumps over the lazy dog', true);
    ctx.currentTime = 10;
    source.onended?.();
    const cues = (await run)!;
    // The same cues `transcribeChannels` gives the 48 kHz stereo fixture above.
    const expected = [
      { start: 0.7, end: 3, text: 'the quick brown fox' },
      { start: 4.7, end: 7, text: 'jumps over the lazy dog' },
    ];
    expect(cues).toHaveLength(expected.length);
    cues.forEach((cue, i) => {
      expect(cue.text).toBe(expected[i].text);
      expect(Math.abs(cue.start - expected[i].start)).toBeLessThan(0.05);
      expect(Math.abs(cue.end - expected[i].end)).toBeLessThan(0.05);
    });
  });

  it('refuses a timeline over the limit before mixing anything, naming the limit and suggesting a section', async () => {
    const createBuffer = vi.fn(fakeBuffer);
    const tooLong = [makeClip({ duration: 10, endTime: 10, timelinePosition: TRANSCRIBE_MAX_SECONDS - 9 })];
    const run = transcribeTimeline({ clips: tooLong, tracks: [makeTrack()], lang: 'en-US', Recognition, createBuffer });
    await expect(run).rejects.toBeInstanceOf(TranscriptionError);
    await expect(run).rejects.toThrow(TRANSCRIBE_TOO_LONG_MESSAGE);
    expect(TRANSCRIBE_TOO_LONG_MESSAGE).toMatch(/3 hours/);
    expect(TRANSCRIBE_TOO_LONG_MESSAGE).toMatch(/section/);
    expect(extractSpeechMix).not.toHaveBeenCalled();
    expect(createBuffer).not.toHaveBeenCalled();
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('hands its signal to the mixer, so a stopped run stops mixing rather than mixing on in the background', async () => {
    const controller = new AbortController();
    vi.mocked(extractSpeechMix).mockImplementation(async (_c, _t, _d, _allocate, signal) => {
      controller.abort();
      if (signal?.aborted) throw new DOMException('Mix stopped', 'AbortError');
      return null;
    });
    await expect(
      transcribeTimeline({ clips: [], tracks: [], lang: 'en-US', Recognition, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.mocked(extractSpeechMix).mock.calls[0][4]).toBe(controller.signal);
  });

  it('mixes a timeline exactly at the limit', async () => {
    vi.mocked(extractSpeechMix).mockResolvedValue(null);
    const atLimit = [makeClip({ duration: 10, endTime: 10, timelinePosition: TRANSCRIBE_MAX_SECONDS - 10 })];
    await expect(transcribeTimeline({ clips: atLimit, tracks: [makeTrack()], lang: 'en-US', Recognition })).resolves.toBeNull();
    expect(extractSpeechMix).toHaveBeenCalledTimes(1);
  });
});

// ESCSUITE-439: the paths the cases above leave untested — the defaults the
// app relies on, results a recogniser can send in odd shapes, and the run
// settling while another step is still under way.
describe('transcribeChannels: defaults, odd results and late events (ESCSUITE-439)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers no cues for a mix with no channels at all', async () => {
    await expect(transcribeChannels({ channels: [], sampleRate: 48000, lang: 'en-US', Recognition })).resolves.toEqual([]);
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('plays through a new AudioContext at the mix rate when none is given', async () => {
    const { ctx, source } = makeContext();
    const made: AudioContextOptions[] = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor(options: AudioContextOptions) {
          made.push(options);
          return ctx;
        }
      }
    );
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 44100, lang: 'en-US', Recognition });
    await flush();
    source.onended?.();
    await expect(run).resolves.toEqual([]);
    expect(made).toEqual([{ sampleRate: 44100 }]);
  });

  it('settles even when closing the context fails', async () => {
    const { ctx, source } = makeContext();
    ctx.close.mockImplementation(() => Promise.reject(new Error('already closed')));
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    FakeRecognition.instances[0].say(0, 'still here', true);
    source.onended?.();
    await expect(run).resolves.toEqual([{ start: 0, end: 1, text: 'still here' }]);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly when the buffer cannot be made, before any source exists', async () => {
    const { ctx } = makeContext();
    ctx.createBuffer.mockImplementation(() => {
      throw new RangeError('buffer too large');
    });
    await expect(
      transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx })
    ).rejects.toThrow('Could not start on-device speech recognition.');
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
    expect(FakeRecognition.instances[0].abort).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });

  it("rejects with the recogniser's own error when it fails as it starts, not with the start that follows", async () => {
    class FailsOnStart extends FakeRecognition {
      start(track?: MediaStreamTrack) {
        super.start(track);
        this.onerror?.({ error: 'network' });
      }
    }
    const { ctx, source } = makeContext();
    // The source was stopped by the failure: starting it now throws, as a real one does.
    source.start.mockImplementation(() => {
      throw new DOMException('stopped', 'InvalidStateError');
    });
    await expect(
      transcribeChannels({
        channels: TEN_SECONDS,
        sampleRate: 48000,
        lang: 'en-US',
        Recognition: FailsOnStart as unknown as SpeechRecognitionCtor,
        createAudioContext: () => ctx,
      })
    ).rejects.toThrow('On-device speech recognition stopped (network).');
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('finishes once when the recogniser ends inside stop() and stop() then throws', async () => {
    const { ctx, source } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    recognition.say(0, 'last words', true);
    recognition.stop.mockImplementation(() => {
      recognition.onend?.();
      throw new DOMException('not started', 'InvalidStateError');
    });
    source.onended?.();
    await expect(run).resolves.toEqual([{ start: 0, end: 1, text: 'last words' }]);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('reads a result with no alternatives as no words yet', async () => {
    const { ctx, source } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    ctx.currentTime = 1;
    recognition.onresult?.({
      resultIndex: 0,
      results: [Object.assign([], { isFinal: false })] as unknown as SpeechResultEventLike['results'],
    });
    ctx.currentTime = 3;
    recognition.say(0, 'then words', true);
    source.onended?.();
    // The cue starts when the empty result first came, as for any first result.
    await expect(run).resolves.toEqual([{ start: 0.7, end: 3, text: 'then words' }]);
  });

  it('ends a cue when its words are final, not when the same interim words repeat', async () => {
    const { ctx, source } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    ctx.currentTime = 1;
    recognition.say(0, 'same words', false);
    ctx.currentTime = 4;
    recognition.say(0, 'same words', false);
    ctx.currentTime = 6;
    recognition.say(0, 'same words', true);
    source.onended?.();
    await expect(run).resolves.toEqual([{ start: 0.7, end: 6, text: 'same words' }]);
  });

  it('keeps a final result past the end of a shorter result list', async () => {
    const { ctx, source } = makeContext();
    const run = transcribeChannels({ channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx });
    await flush();
    const [recognition] = FakeRecognition.instances;
    const event = (results: Array<[string, boolean]>) =>
      recognition.onresult?.({
        resultIndex: 0,
        results: results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) as unknown as SpeechResultEventLike['results'],
      });
    ctx.currentTime = 1;
    event([['first', true], ['second', true]]);
    ctx.currentTime = 4;
    event([['first', true]]);
    source.onended?.();
    const cues = await run;
    expect(cues.map((c) => c.text)).toEqual(['first', 'second']);
  });

  it('starts nothing when stopped while the context is still starting', async () => {
    const { ctx, source } = makeContext();
    let resumed!: () => void;
    ctx.resume.mockReturnValue(new Promise<void>((r) => (resumed = r)));
    const controller = new AbortController();
    const run = transcribeChannels({
      channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx, signal: controller.signal,
    });
    await flush();
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    resumed();
    await flush();
    expect(FakeRecognition.instances[0].starts).toEqual([]);
    expect(source.start).not.toHaveBeenCalled();
  });

  it('does not listen again when a session ends after the run was stopped', async () => {
    const { ctx } = makeContext();
    const controller = new AbortController();
    const run = transcribeChannels({
      channels: TEN_SECONDS, sampleRate: 48000, lang: 'en-US', Recognition, createAudioContext: () => ctx, signal: controller.signal,
    });
    await flush();
    const [recognition] = FakeRecognition.instances;
    // A recogniser that delivers `end` from a handler it read before cleaning up.
    const onend = recognition.onend!;
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    onend();
    expect(recognition.starts).toHaveLength(1);
  });
});

describe('transcribeTimeline: the default buffer (ESCSUITE-439)', () => {
  beforeEach(() => {
    vi.mocked(extractSpeechMix).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the mix into a new one-channel AudioBuffer at the speech rate when none is given', async () => {
    const made: AudioBufferOptions[] = [];
    vi.stubGlobal(
      'AudioBuffer',
      class {
        constructor(options: AudioBufferOptions) {
          made.push(options);
          return fakeBuffer(options.numberOfChannels!, options.length, options.sampleRate);
        }
      }
    );
    vi.mocked(extractSpeechMix).mockImplementation(async (_c, _t, _d, allocate) => {
      allocate!(16_000);
      return null;
    });
    await expect(transcribeTimeline({ clips: [], tracks: [], lang: 'en-US', Recognition })).resolves.toBeNull();
    expect(made).toEqual([{ numberOfChannels: 1, length: 16_000, sampleRate: 16000 }]);
  });
});
