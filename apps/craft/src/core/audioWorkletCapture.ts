/**
 * How the WebCodecs recorder takes its audio off the Web Audio graph
 * (ESCSUITE-299): one `createAudioCapture()` per audio pipeline — the mix, and
 * each audio companion of a separate-tracks take — that hands the pipeline's
 * encoder stamped `AudioData` and hides which of two paths is doing it.
 *
 * **The AudioWorklet path.** A processor (`AUDIO_CAPTURE_WORKLET_SOURCE`) runs
 * on the render thread for every 128-frame quantum without exception and reads
 * the render position exactly (`currentFrame`). It gathers quanta into chunks
 * of `CHUNK_FRAMES` per channel and posts each with the render position of its
 * first sample, its buffers transferred. A `MessagePort` queues what it is
 * given and never drops it, so however late the page gets to a chunk, the
 * chunk says where it was rendered: the audio is stamped on the render clock
 * itself, with nothing to fill and no threshold to tune.
 *
 * **The ScriptProcessorNode path** — the fallback, for a browser with no
 * `audioWorklet` or whose `addModule()` refuses the module — is ESCSUITE-296's
 * capture exactly as it was: a 4096-sample `ScriptProcessorNode`, the samples
 * it delivers counted into the stamps, and `createAudioGapFiller()` filling
 * what the page never saw. The filler lives on this path only.
 *
 * Which path a take gets is decided once per `AudioContext` (so once per take,
 * however many pipelines it has) and logged once, at info level.
 */
import { createAudioGapFiller } from './audioGapFiller';

/** Frames per channel in each chunk the processor posts: ~85 ms at 48 kHz. */
export const CHUNK_FRAMES = 4096;

/** The name the processor is registered under. */
export const AUDIO_CAPTURE_PROCESSOR_NAME = 'escapecraft-capture';

/**
 * How long `stop()` waits for the processor to hand over its tail. The round
 * trip is a few milliseconds; a render thread that does not answer in a second
 * has stopped (a suspended context, say), and a take must not wait on it.
 */
export const FLUSH_TIMEOUT_MS = 1000;

/** The fallback's `ScriptProcessorNode` buffer: 4096 samples, ~85 ms at 48 kHz. */
const SCRIPT_PROCESSOR_BUFFER = 4096;

/**
 * The processor, as the source text of a worklet module.
 *
 * Plain JavaScript run in an `AudioWorkletGlobalScope`, where `currentFrame`
 * is a global. Each chunk is two fresh `Float32Array`s that are transferred,
 * not copied, so nothing on the render thread is reused after it is posted.
 * The node is built with two channels, explicit, so an input has either two
 * channels or — with nothing actively connected — none, which is silence.
 * `'flush'` is the only message it is sent: it posts what it has gathered (if
 * anything), acknowledges with `{ flushed: true }` behind it on the same port,
 * and stops processing.
 */
export const AUDIO_CAPTURE_WORKLET_SOURCE = `
const CHUNK_FRAMES = ${CHUNK_FRAMES};

class EscapeCraftCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null;
    this.frame = 0;
    this.filled = 0;
    this.flushed = false;
    this.port.onmessage = () => {
      if (this.filled > 0) this.post();
      this.port.postMessage({ flushed: true });
      this.flushed = true;
    };
  }

  post() {
    const channels =
      this.filled === CHUNK_FRAMES ? this.channels : this.channels.map((c) => c.slice(0, this.filled));
    this.port.postMessage({ frame: this.frame, channels }, channels.map((c) => c.buffer));
    this.filled = 0;
  }

  process(inputs) {
    if (this.flushed) return false;
    const input = inputs[0];
    const length = input.length > 0 ? input[0].length : 128;
    let offset = 0;
    while (offset < length) {
      if (this.filled === 0) {
        this.frame = currentFrame + offset;
        this.channels = [new Float32Array(CHUNK_FRAMES), new Float32Array(CHUNK_FRAMES)];
      }
      const count = Math.min(length - offset, CHUNK_FRAMES - this.filled);
      if (input.length > 0) {
        this.channels[0].set(input[0].subarray(offset, offset + count), this.filled);
        this.channels[1].set(input[1].subarray(offset, offset + count), this.filled);
      }
      this.filled += count;
      offset += count;
      if (this.filled === CHUNK_FRAMES) this.post();
    }
    return true;
  }
}

registerProcessor('${AUDIO_CAPTURE_PROCESSOR_NAME}', EscapeCraftCapture);
`;

export interface AudioCaptureOptions {
  /**
   * Hand one `AudioData` to the pipeline's encoder. Planar f32, at the
   * context's own rate, stamped on the take's clock. The capture closes it
   * when this returns, and logs `Audio encoding error:` if this throws.
   */
  onChunk: (data: AudioData) => void;
  /** Names the pipeline in a warning: a capped fill, or a tail that never came. */
  label: string;
}

/**
 * One pipeline's audio capture. `start()`, `pause()` and `resume()` follow the
 * take's own; `stop()` delivers whatever is still on its way and lets the node
 * go; `close()` lets it go at once, delivering nothing more. Both are safe to
 * call again.
 */
export interface AudioCapture {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  close(): void;
}

type CapturePath = 'worklet' | 'script-processor';

/** The path each context's take was given — decided by its first capture. */
const paths = new WeakMap<BaseAudioContext, Promise<CapturePath>>();

/**
 * Load the processor into this context, or say why not. The module goes in as
 * a Blob URL — there is no file to serve it from in a single-file build — and
 * the URL is revoked as soon as `addModule()` has settled either way.
 */
async function choosePath(context: BaseAudioContext): Promise<CapturePath> {
  const worklet: AudioWorklet | undefined = context.audioWorklet;
  if (!worklet) {
    console.info('Recording audio through a ScriptProcessorNode: this browser has no AudioWorklet');
    return 'script-processor';
  }
  const url = URL.createObjectURL(
    new Blob([AUDIO_CAPTURE_WORKLET_SOURCE], { type: 'text/javascript' })
  );
  try {
    await worklet.addModule(url);
  } catch (e) {
    console.info('Recording audio through a ScriptProcessorNode: the AudioWorklet module would not load:', e);
    return 'script-processor';
  } finally {
    URL.revokeObjectURL(url);
  }
  console.info('Recording audio through an AudioWorklet');
  return 'worklet';
}

function pathFor(context: BaseAudioContext): Promise<CapturePath> {
  let path = paths.get(context);
  if (!path) {
    path = choosePath(context);
    paths.set(context, path);
  }
  return path;
}

/**
 * A capture of `source` for one pipeline, on whichever path this context's
 * take was given. Never rejects for want of an AudioWorklet: that is the
 * fallback.
 */
export async function createAudioCapture(
  context: AudioContext,
  source: AudioNode,
  options: AudioCaptureOptions
): Promise<AudioCapture> {
  const path = await pathFor(context);
  return path === 'worklet'
    ? createWorkletCapture(context, source, options)
    : createScriptProcessorCapture(context, source, options);
}

/** What the processor posts. */
type ProcessorMessage = { frame: number; channels: Float32Array[] } | { flushed: true };

/**
 * A stretch of the render clock that is being recorded: `[from, to)` in render
 * frames, and the frames recorded before it — what a chunk in it is offset by.
 */
interface RecordedSpan {
  from: number;
  to: number;
  offset: number;
}

/**
 * The AudioWorklet path.
 *
 * Every decision is by render position, never by when a chunk arrives: the
 * take is a list of recorded spans of the render clock — `start()` opens one,
 * `pause()` closes it, `resume()` opens the next — and a chunk is kept when
 * its first frame falls inside one. It is stamped
 * `(frame − span start + frames recorded before the span) / sampleRate`, so
 * the paused render frames are taken out of the audio exactly as the recorder
 * takes the paused context time out of the video, and a chunk that arrives
 * after a pause (or a resume) is still judged by where it was rendered.
 *
 * The page reads the render position as `currentTime × sampleRate` — the same
 * frame count the processor's `currentFrame` reports — at `start()`, `pause()`
 * and `resume()`. Decisions are per chunk, so a chunk that straddles a span
 * edge goes with the span its first frame is in: up to one chunk (~85 ms)
 * either side of a pause or of `start()`, never cumulative.
 */
function createWorkletCapture(
  context: AudioContext,
  source: AudioNode,
  { onChunk, label }: AudioCaptureOptions
): AudioCapture {
  const node = new AudioWorkletNode(context, AUDIO_CAPTURE_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const { sampleRate } = context;
  const spans: RecordedSpan[] = [];
  let closed = false;
  let stopped: Promise<void> | null = null;
  /** Resolves the pending `stop()`, once `close()` runs. */
  let settle: (() => void) | null = null;

  const renderFrame = () => Math.round(context.currentTime * sampleRate);

  const close = () => {
    if (closed) return;
    closed = true;
    node.port.onmessage = null;
    node.port.close();
    node.disconnect();
    settle?.();
  };

  node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
    const message = event.data;
    if ('flushed' in message) {
      close();
      return;
    }
    const { frame, channels } = message;
    let span: RecordedSpan | null = null;
    for (let i = 0; i < spans.length; i++) {
      if (frame >= spans[i].from && frame < spans[i].to) {
        span = spans[i];
        break;
      }
    }
    if (!span) return;

    const numberOfFrames = channels[0].length;
    const planar = new Float32Array(numberOfFrames * channels.length);
    for (let c = 0; c < channels.length; c++) planar.set(channels[c], c * numberOfFrames);
    try {
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames,
        numberOfChannels: channels.length,
        timestamp: Math.round(((frame - span.from + span.offset) / sampleRate) * 1_000_000),
        data: planar,
      });
      try {
        onChunk(audioData);
      } finally {
        audioData.close();
      }
    } catch (e) {
      console.error('Audio encoding error:', e);
    }
  };

  source.connect(node);
  // Silent: the processor never writes its output. Connected so the engine
  // pulls the node, as the ScriptProcessorNode it replaces was.
  node.connect(context.destination);

  return {
    start() {
      spans.push({ from: renderFrame(), to: Infinity, offset: 0 });
    },
    pause() {
      spans[spans.length - 1].to = renderFrame();
    },
    resume() {
      const last = spans[spans.length - 1];
      spans.push({ from: renderFrame(), to: Infinity, offset: last.offset + (last.to - last.from) });
    },
    stop() {
      stopped ??= closed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              console.warn(
                `${label}: the audio capture did not hand over its last ${CHUNK_FRAMES} frames within ${FLUSH_TIMEOUT_MS} ms; they are lost`
              );
              close();
            }, FLUSH_TIMEOUT_MS);
            settle = () => {
              clearTimeout(timer);
              resolve();
            };
            node.port.postMessage('flush');
          });
      return stopped;
    },
    close,
  };
}

/**
 * The ScriptProcessorNode path: ESCSUITE-296's capture, moved here unchanged.
 *
 * Stamps count the samples delivered since `start()`, at the context's rate;
 * a callback before `start()` or while paused is not counted; the gap filler
 * re-anchors at `start()` and at every `resume()`, because what the page did
 * not see while paused is the pause, not a loss. `stop()` and `close()` are
 * the same thing here: the node is disconnected, once, and is never revived
 * by a later `start()` or `resume()`.
 */
function createScriptProcessorCapture(
  context: AudioContext,
  source: AudioNode,
  { onChunk, label }: AudioCaptureOptions
): AudioCapture {
  const processor = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 2, 2);
  const { sampleRate } = context;
  const gapFiller = createAudioGapFiller({
    sampleRate,
    bufferLength: SCRIPT_PROCESSOR_BUFFER,
    numberOfChannels: 2,
    label,
    readCurrentTime: () => context.currentTime,
    encode: onChunk,
  });
  let recording = false;
  let ended = false;
  let timestampUs = 0;

  processor.onaudioprocess = (event) => {
    if (!recording) return;

    const leftChannel = event.inputBuffer.getChannelData(0);
    const rightChannel = event.inputBuffer.getChannelData(1);
    const numberOfFrames = leftChannel.length;

    const planarData = new Float32Array(numberOfFrames * 2);
    for (let i = 0; i < numberOfFrames; i++) {
      planarData[i] = leftChannel[i];
      planarData[numberOfFrames + i] = rightChannel[i];
    }

    try {
      timestampUs = gapFiller.fill(event.playbackTime, numberOfFrames, timestampUs);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames,
        numberOfChannels: 2,
        timestamp: timestampUs,
        data: planarData,
      });
      // try/finally, because `encode()` throws on a codec that has been closed
      // under us: `close()` as the next statement leaked the decoded buffer
      // once per callback, ~11.7 times a second, for as long as it refused.
      try {
        onChunk(audioData);
      } finally {
        audioData.close();
      }
      timestampUs += (numberOfFrames / sampleRate) * 1_000_000;
    } catch (e) {
      console.error('Audio encoding error:', e);
    }
  };

  source.connect(processor);
  processor.connect(context.destination);

  const end = () => {
    if (ended) return;
    ended = true;
    recording = false;
    processor.disconnect();
  };

  return {
    start() {
      timestampUs = 0;
      gapFiller.reanchor();
      recording = !ended;
    },
    pause() {
      recording = false;
    },
    resume() {
      gapFiller.reanchor();
      recording = !ended;
    },
    stop() {
      end();
      return Promise.resolve();
    },
    close: end,
  };
}
