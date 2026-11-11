// "Transcribe to captions" (ESCSUITE-404): the timeline's own sound, played
// into the browser's **on-device** speech recogniser, turned into caption cues.
//
// Reached only through a dynamic `import()` from `TranscribeControl`, on the
// first click. The single-file builds inline dynamic imports
// (`inlineDynamicImports: true`), so today it ships inside the one bundle; it
// has no top-level side effects, and a build that splits chunks would load it
// on demand with no change here.
//
// How: the export's own mixer renders the timeline to PCM, downmixed to one
// channel at 16 kHz (`extractSpeechMix`, ESCSUITE-433) straight into the
// `AudioBuffer` that plays it; that buffer plays, in real time, into a `MediaStreamAudioDestinationNode`
// — never the speakers — and the destination's audio track goes to
// `recognition.start(track)` (the Web Speech API's MediaStreamTrack input), so
// no microphone is opened. The recogniser is created with
// `processLocally = true` and refused if it does not read that back: by
// default the API sends audio to the browser vendor's servers, and that is
// never allowed here. There is no cloud fallback.
//
// The recogniser reports words, not times. A cue starts a moment before its
// words were first heard (the first interim result for them) and ends when
// the recogniser settled on them (their final result), measured on the
// playback's own clock; long results are split into caption-sized pieces with
// the time shared out by length. The times are estimates the user can nudge.

import type { Clip, Track } from '../store/types';
import type { CaptionCue } from './captions';
import { extractSpeechMix, SPEECH_MIX_SAMPLE_RATE } from './audioMixer';
import { calculateTimelineDuration, EXPORT_AUDIO_SAMPLE_RATE, EXPORT_MAX_SECONDS } from './exportTypes';
import type {
  SpeechErrorEventLike,
  SpeechRecognitionCtor,
  SpeechRecognitionLike,
  SpeechResultEventLike,
} from './speechRecognitionLocal';

/** How far before its first interim result a cue starts: recognisers answer a little after the words. */
export const HEARD_LEAD_SECONDS = 0.3;
/** The shortest cue written. */
export const MIN_CUE_SECONDS = 1;
/** The most characters in one cue — two caption lines' worth at the widest wrap (42 columns). */
export const MAX_CUE_CHARS = 84;
/** How often progress is reported while the sound plays, in ms. */
const PROGRESS_INTERVAL_MS = 250;
/**
 * The longest timeline transcribed at once (ESCSUITE-433): the export's own
 * limit. Its 16 kHz mono mix is 64,000 bytes a second, 691 MB at the limit.
 */
export const TRANSCRIBE_MAX_SECONDS = EXPORT_MAX_SECONDS;
/** Why a timeline longer than {@link TRANSCRIBE_MAX_SECONDS} is refused, and what to do instead. */
export const TRANSCRIBE_TOO_LONG_MESSAGE =
  'Cannot transcribe more than 3 hours at once. Save a copy of the project, cut it down to a section of up to 3 hours, and transcribe that.';
/** Recogniser errors that only mean "nothing was said" and do not end a transcription. */
const BENIGN_ERRORS = new Set(['no-speech', 'aborted']);

/** A transcription that could not finish. The message is shown to the user as it is. */
export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/** One stretch of speech as the recogniser reported it, on the playback clock (seconds). */
export interface HeardSegment {
  text: string;
  /** When its first result (interim or final) arrived. */
  heardAt: number;
  /** When its final result arrived (or, at the end, its last interim one). */
  finalAt: number;
}

/**
 * Create the one recogniser a transcription uses. **The only place in the app
 * that constructs a `SpeechRecognition`**, and it sets `processLocally = true`
 * before anything else and throws if the browser does not keep it: without it
 * the browser would send the audio off the device.
 */
export function createLocalRecognition(Recognition: SpeechRecognitionCtor, lang: string): SpeechRecognitionLike {
  const recognition = new Recognition();
  recognition.processLocally = true;
  if (recognition.processLocally !== true) {
    try { recognition.abort(); } catch { /* never started */ }
    throw new TranscriptionError('This browser cannot transcribe on this device.');
  }
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  return recognition;
}

const round3 = (t: number) => Math.round(t * 1000) / 1000;

/** `text` cut at word boundaries into pieces of at most `MAX_CUE_CHARS` (a longer single word stays whole). */
export function splitCueText(text: string, maxChars = MAX_CUE_CHARS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > maxChars) {
      pieces.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Turn what was heard into caption cues on the timeline (seconds), in order,
 * never overlapping and never past `duration`.
 */
export function cuesFromSegments(segments: readonly HeardSegment[], duration: number): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let prevEnd = 0;
  const ordered = segments
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.heardAt - b.heardAt);
  for (const segment of ordered) {
    let start = Math.min(Math.max(prevEnd, segment.heardAt - HEARD_LEAD_SECONDS, 0), duration);
    const end = Math.min(duration, Math.max(segment.finalAt, start + MIN_CUE_SECONDS));
    if (end - start < MIN_CUE_SECONDS) start = Math.max(prevEnd, end - MIN_CUE_SECONDS);
    if (end - start <= 0.001) {
      // No room left at the very end of the timeline: the words join the cue before.
      const last = cues[cues.length - 1];
      if (last) last.text = `${last.text} ${segment.text}`;
      continue;
    }
    const pieces = splitCueText(segment.text);
    const totalChars = pieces.reduce((sum, p) => sum + p.length, 0);
    let at = start;
    pieces.forEach((piece, i) => {
      const pieceEnd = i === pieces.length - 1 ? end : at + ((end - start) * piece.length) / totalChars;
      cues.push({ start: round3(at), end: round3(pieceEnd), text: piece });
      at = pieceEnd;
    });
    prevEnd = end;
  }
  return cues;
}

/** The slice of an `AudioContext` a transcription uses. */
export interface TranscribeAudioContext {
  readonly currentTime: number;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  createMediaStreamDestination(): MediaStreamAudioDestinationNode;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface TranscribeOptions {
  /** The mix, one array per channel. */
  channels: readonly Float32Array[];
  sampleRate: number;
  lang: string;
  Recognition: SpeechRecognitionCtor;
  /** Defaults to `new AudioContext({ sampleRate })`. */
  createAudioContext?: (sampleRate: number) => TranscribeAudioContext;
  /** Aborting stops at once and rejects with an `AbortError`; nothing is kept. */
  signal?: AbortSignal;
  /** Seconds of the mix played so far, and its length. */
  onProgress?: (playedSeconds: number, totalSeconds: number) => void;
}

function abortError(): DOMException {
  return new DOMException('Transcription cancelled', 'AbortError');
}

/** Words for a recogniser error, as the user reads them. */
export function describeRecognitionError(error: string): string {
  switch (error) {
    case 'language-not-supported':
      return 'The speech language pack for this language is not installed on this device.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The browser did not allow on-device speech recognition here.';
    default:
      return `On-device speech recognition stopped (${error}).`;
  }
}

/**
 * Play `channels` into the on-device recogniser and resolve with the cues it
 * heard. Takes as long as the mix is long: the recogniser listens in real time.
 */
export function transcribeChannels(options: TranscribeOptions): Promise<CaptionCue[]> {
  const { channels, sampleRate } = options;
  const frames = channels[0]?.length ?? 0;
  return listen({
    ...options,
    frames,
    contextRate: sampleRate,
    makeBuffer: (ctx) => {
      const buffer = ctx.createBuffer(channels.length, frames, sampleRate);
      channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
      return buffer;
    },
  });
}

interface ListenOptions extends Omit<TranscribeOptions, 'channels'> {
  /** The mix's length, in frames at `sampleRate`. */
  frames: number;
  /** The playback context's rate; the buffer may be at another, which the source resamples. */
  contextRate: number;
  /** The buffer that plays: built in the context, or handed over already filled. */
  makeBuffer: (ctx: TranscribeAudioContext) => AudioBuffer;
}

function listen(options: ListenOptions): Promise<CaptionCue[]> {
  const { frames, sampleRate, contextRate, makeBuffer, lang, Recognition, signal, onProgress } = options;
  const duration = frames / sampleRate;
  if (signal?.aborted) return Promise.reject(abortError());
  if (frames === 0) return Promise.resolve([]);

  // Created first: if the browser will not keep `processLocally`, nothing plays.
  const recognition = createLocalRecognition(Recognition, lang);
  const createContext =
    options.createAudioContext ?? ((rate: number) => new AudioContext({ sampleRate: rate }) as TranscribeAudioContext);

  return new Promise<CaptionCue[]>((resolve, reject) => {
    const ctx = createContext(contextRate);
    let startedAt = 0;
    let settled = false;
    let playbackEnded = false;
    let session = 0;
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    const heard = new Map<string, HeardSegment>();
    const finals = new Set<string>();
    let source: AudioBufferSourceNode | null = null;

    const clock = () => Math.max(0, Math.min(duration, ctx.currentTime - startedAt));

    const cleanUp = () => {
      if (progressTimer !== undefined) clearInterval(progressTimer);
      signal?.removeEventListener('abort', onAbort);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      // Stopping the source fires its `ended` event later: it must not report
      // progress or stop the recogniser after the transcription has settled.
      if (source) source.onended = null;
      try { source?.stop(); } catch { /* already stopped */ }
      try { source?.disconnect(); } catch { /* not connected */ }
      void ctx.close().catch(() => {});
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try { recognition.abort(); } catch { /* not running */ }
      cleanUp();
      reject(error);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve(cuesFromSegments([...heard.values()], duration));
    };
    function onAbort() {
      fail(abortError());
    }
    signal?.addEventListener('abort', onAbort);

    recognition.onresult = (event: SpeechResultEventLike) => {
      const now = clock();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? '';
        const key = `${session}:${i}`;
        const segment = heard.get(key);
        if (!segment) heard.set(key, { text, heardAt: now, finalAt: now });
        else if (segment.text !== text || result.isFinal) {
          segment.text = text;
          segment.finalAt = now;
        }
        if (result?.isFinal) finals.add(key);
      }
      // `results` is the session's whole current list: an interim result past
      // its end was folded into an earlier one, and must not become a cue of its own.
      for (let i = event.results.length; heard.has(`${session}:${i}`); i++) {
        if (!finals.has(`${session}:${i}`)) heard.delete(`${session}:${i}`);
      }
    };
    recognition.onerror = (event: SpeechErrorEventLike) => {
      if (BENIGN_ERRORS.has(event.error)) return;
      fail(new TranscriptionError(describeRecognitionError(event.error)));
    };

    void (async () => {
      try {
        const buffer = makeBuffer(ctx);
        source = ctx.createBufferSource();
        source.buffer = buffer;
        const destination = ctx.createMediaStreamDestination();
        source.connect(destination);
        await ctx.resume();
        if (settled) return;
        const track = destination.stream.getAudioTracks()[0];
        if (!track) throw new TranscriptionError('The browser gave no audio track to transcribe.');

        recognition.onend = () => {
          if (settled) return;
          // The recogniser can end a session on a long silence; while the
          // sound still plays, it listens again (a new session, new indices).
          if (!playbackEnded) {
            session++;
            try { recognition.start(track); return; } catch { /* fall through and keep what was heard */ }
          }
          finish();
        };
        source.onended = () => {
          playbackEnded = true;
          onProgress?.(duration, duration);
          // `stop()` asks for the final results of what it has heard; `onend` follows.
          try { recognition.stop(); } catch { finish(); }
        };

        recognition.start(track);
        startedAt = ctx.currentTime;
        source.start();
        onProgress?.(0, duration);
        progressTimer = setInterval(() => onProgress?.(clock(), duration), PROGRESS_INTERVAL_MS);
      } catch (error) {
        fail(error instanceof TranscriptionError ? error : new TranscriptionError('Could not start on-device speech recognition.'));
      }
    })();
  });
}

export interface TranscribeTimelineOptions {
  clips: Clip[];
  tracks: Track[];
  lang: string;
  Recognition: SpeechRecognitionCtor;
  signal?: AbortSignal;
  /** `'mixing'` while the sound is rendered, then `'listening'` with seconds played. */
  onProgress?: (phase: 'mixing' | 'listening', played: number, total: number) => void;
  /** Defaults to `new AudioBuffer(…)`: the one buffer the mix is written into and played from. */
  createBuffer?: (numberOfChannels: number, length: number, sampleRate: number) => AudioBuffer;
  /** Defaults to `new AudioContext({ sampleRate })`. */
  createAudioContext?: (sampleRate: number) => TranscribeAudioContext;
}

/**
 * The whole timeline's sound, as the export mixes it, transcribed on this
 * device. `null` when the timeline has no sound to transcribe.
 *
 * ESCSUITE-433: the recogniser hears one channel at 16 kHz, mixed straight
 * into the buffer that plays it, so an hour of timeline holds 230 MB rather
 * than the export's 1.38 GB stereo 48 kHz mix and a second copy of it. A
 * timeline longer than {@link TRANSCRIBE_MAX_SECONDS} is refused before
 * anything is mixed.
 */
export async function transcribeTimeline(options: TranscribeTimelineOptions): Promise<CaptionCue[] | null> {
  const { clips, tracks, lang, Recognition, signal, onProgress } = options;
  const duration = calculateTimelineDuration(clips);
  if (duration > TRANSCRIBE_MAX_SECONDS) throw new TranscriptionError(TRANSCRIBE_TOO_LONG_MESSAGE);
  const createBuffer =
    options.createBuffer ??
    ((numberOfChannels: number, length: number, sampleRate: number) =>
      new AudioBuffer({ numberOfChannels, length, sampleRate }));
  onProgress?.('mixing', 0, duration);
  let buffer: AudioBuffer | null = null;
  // The signal stops the mix itself, so a stopped run frees its memory at once.
  const mix = await extractSpeechMix(
    clips,
    tracks,
    duration,
    (frames) => {
      buffer = createBuffer(1, frames, SPEECH_MIX_SAMPLE_RATE);
      return buffer.getChannelData(0);
    },
    signal
  );
  if (signal?.aborted) throw abortError();
  if (!mix || !buffer) return null;
  const filled: AudioBuffer = buffer;
  return listen({
    frames: filled.length,
    sampleRate: SPEECH_MIX_SAMPLE_RATE,
    // The stream the recogniser hears stays at the export's rate, as before;
    // the source node resamples the 16 kHz buffer into it.
    contextRate: EXPORT_AUDIO_SAMPLE_RATE,
    makeBuffer: () => filled,
    lang,
    Recognition,
    createAudioContext: options.createAudioContext,
    signal,
    onProgress: (played, total) => onProgress?.('listening', played, total),
  });
}
