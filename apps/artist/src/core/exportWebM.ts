// WebM export via WebCodecs + Mediabunny
// VP9 video + Opus audio, frame-by-frame encoding

import {
  Output,
  WebMOutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';
import type { Clip, SourceVideo, Track, ExportOptions } from '../store/types';
import type { ExportResult, MediaDrawOptions, ProgressCallback } from './exportTypes';
import { projectToOutputScale } from './outputTransform';
import {
  checkAborted,
  getQualitySettings,
  getResolution, getBaseDimensions,
  yieldToMain,
  calculateTimelineDuration,
  assertExportableLength,
  findSupportedVideoConfig,
  webMVideoCodecConfigs,
  waitForEncoderBackpressure,
  hasWebMEncodeGlobals,
  EXPORT_AUDIO_CHANNELS,
  EXPORT_AUDIO_SAMPLE_RATE,
  isAudioCodecSupported,
  noAudioNote,
  opusEncoderConfig,
  // Shared with exportMP4.ts, which re-exports it for existing callers — both
  // exporters import it from its actual home so neither depends on the other
  // (ESCSUITE-152 moved it here; ESCSUITE-29 Mechanism 1 is why this file
  // needs it at all).
  ExportError,
  type ExportLogEntry,
} from './exportTypes';
import {
  createFrameComposer,
  createElementSourceRelease,
  loadElementSources,
  rewindElementSources,
} from './elementFrames';
import { extractAndMixAudio } from './audioMixer';

/**
 * Export timeline to WebM using WebCodecs + webm-muxer
 * Frame-by-frame encoding with proper seeking support
 */
export async function exportToWebM(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  signal?: AbortSignal,
  projectResolution?: { width: number; height: number }
): Promise<ExportResult> {
  // WebM never decodes through WebCodecs (this exporter seeks
  // HTMLVideoElements directly), so only VideoEncoder/VideoFrame need to
  // exist — unlike `isMP4ExportSupported()`, which also needs VideoDecoder.
  // Whether a WebCodecs-capable browser can actually *configure* VP9 or VP8
  // is answered below, by the real ladder, not here. `hasWebMEncodeGlobals()`
  // is the one predicate this and `isWebMExportSupported` both read (review
  // round 1, MAJOR 2(d)): it used to be written out here a second time.
  if (!hasWebMEncodeGlobals()) {
    throw new Error('WebM export requires WebCodecs API (Chrome/Edge)');
  }

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Check for early abort
  checkAborted(signal);

  // Diagnostic logging for debugging export failures — mirrors exportMP4.ts,
  // so a failure from either exporter carries the same kind of trail.
  const exportLog: ExportLogEntry[] = [];
  const log = (phase: string, detail: string) => {
    exportLog.push({ phase, detail, timestamp: performance.now() });
  };

  log('init', `Starting WebM export with ${clips.length} clips`);

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  // Use the bottom-most track's source dimensions as the base
  const { width: baseWidth, height: baseHeight } = getBaseDimensions(clips, exportTracks, sourceVideos);
  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight, projectResolution);

  // Defensive guard at the door (ESCSUITE-152): see exportMP4.ts's twin
  // check for why — a hand-built `projectResolution` can still bypass
  // `parseProject`, and this is clearer than whatever WebCodecs would say.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new ExportError(
      `Cannot export at ${width}x${height}: resolved output resolution must be at least 2x2`,
      exportLog
    );
  }

  const { videoBitrate, audioBitrate } = getQualitySettings(options.quality);
  const frameRate = 30;
  const sampleRate = EXPORT_AUDIO_SAMPLE_RATE;

  // A timeline with no length cannot be mixed or encoded (ESCSUITE-257): refuse
  // it before anything below spends work on it.
  assertExportableLength(calculateTimelineDuration(clips), 'webm', exportLog);
  // And the length that will actually be encoded: a selected range's own.
  if (options.timeRange) {
    assertExportableLength(options.timeRange.end - options.timeRange.start, 'webm', exportLog);
  }

  // Probe VP9, falling back to VP8, at the real output size and bitrate —
  // before loading any media or constructing any encoder (ESCSUITE-29
  // Mechanism 1: the old code hard-coded 'vp09.00.10.08' with no probe at
  // all). `findSupportedVideoConfig`/`webMVideoCodecConfigs` are the same
  // helpers the MP4 H.264 ladder uses, so the probe and the real
  // `configure()` below ask about the exact same configuration.
  const foundVideoConfig = await findSupportedVideoConfig(
    webMVideoCodecConfigs(width, height, videoBitrate, frameRate)
  );
  if (!foundVideoConfig) {
    log('codec', 'No supported WebM video codec found (tried VP9, VP8)');
    throw new ExportError(
      'No supported video codec found. WebM export requires VP9 or VP8 support.',
      exportLog
    );
  }
  // The muxer track family follows the candidate we asked about, never the
  // browser's own (possibly differently-spelled) normalised answer (review
  // round 1, MINOR 3/NIT 3) — `webMVideoCodecConfigs` only ever offers
  // `'vp09.00.10.08'` or `'vp8'`, so this is an exact match, not a guess.
  const { config: videoConfig, candidate: videoCandidate } = foundVideoConfig;
  const videoCodecFamily = videoCandidate.codec === 'vp8' ? 'vp8' : 'vp9';
  log('codec', `Selected WebM codec: ${videoCandidate.codec} (${width}x${height} @ ${videoBitrate}bps)`);
  console.log(`[WebM Export] Using video codec: ${videoCandidate.codec}`);

  // The space every draw call below is in, as against the raster they land on.
  // A caller with no project resolution (only the tests, today — both the editor
  // and the headless renderer always pass one) gets the base dimensions, which is
  // the same stand-in `getResolution` uses for 'project'.
  const projectSize = projectResolution && projectResolution.width > 0 && projectResolution.height > 0
    ? { width: projectResolution.width, height: projectResolution.height }
    : { width: baseWidth, height: baseHeight };
  // Hoisted out of the frame loop: both are constant for the whole export, and
  // neither should cost an allocation per frame.
  const outputSize = { width, height };
  const drawOptions: MediaDrawOptions = {
    filterScale: projectToOutputScale(projectSize, outputSize),
  };

  // Calculate total duration, respecting timeRange if specified
  const fullDuration = calculateTimelineDuration(clips);
  const rangeStart = options.timeRange?.start ?? 0;
  const rangeEnd = options.timeRange?.end ?? fullDuration;
  const totalDuration = rangeEnd - rangeStart;
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // Extract and mix audio first, on the main thread
  // Note: we extract the full timeline audio, then slice it later
  onProgress({ phase: 'preparing', progress: 2, message: 'Extracting audio...' });

  const fullAudioData = await extractAndMixAudio(clips, exportTracks, fullDuration, (p) => {
    onProgress({ phase: 'preparing', progress: 2 + p * 0.08, message: 'Extracting audio...' });
  });

  // Slice audio to the selected time range
  // Audio is stereo interleaved (2 channels), so multiply sample indices by 2
  const audioChannels = EXPORT_AUDIO_CHANNELS;
  // Set only by the Opus probe below, and read only by the result: the one
  // thing the caller cannot work out for itself (ESCSUITE-175 fix round).
  let audioDropped = false;
  let audioData = fullAudioData && options.timeRange ? (() => {
    const startSample = Math.floor(rangeStart * sampleRate) * audioChannels;
    const endSample = Math.floor(rangeEnd * sampleRate) * audioChannels;
    return fullAudioData.slice(startSample, endSample);
  })() : fullAudioData;

  // Create canvas for frame rendering
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Load all unique source media (videos and images)
  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  const sources = await loadElementSources(clips, sourceMap);

  // From here on the media elements are this function's to free, so the `try`
  // starts at the load and not at the frame loop (ESCSUITE-156). Everything
  // between the two can throw — `output.start()`, either `configure()`, the
  // caller's own progress callback, the rewind — and every one of those throws
  // used to escape past the only `releaseElementSources` on the error path,
  // leaking a `<video>` or `<img>` and its object URL per source for the life of
  // the page. The two handles the `catch` needs live out here: `frameCount`, for
  // the diagnostic log, and every encoder built so far, so the catch can close
  // what exists without caring how far construction got.
  //
  // The muxer is the third (ESCSUITE-159): an `Output` that is still mid-file
  // holds its writer and its unfinalised target, and `cancel()` is Mediabunny's
  // own call for releasing them. The handle is recorded as soon as the `Output`
  // exists — before `start()`, so a `start()` that throws is covered too — and
  // *which* outputs still need the call is answered by Mediabunny's own
  // `state`, not by a flag kept out here: see the catch.
  const openEncoders: Array<VideoEncoder | AudioEncoder> = [];
  let muxerOutput: Output | null = null;
  let frameCount = 0;

  const releaseSources = createElementSourceRelease(sources);

  try {
    onProgress({ phase: 'encoding', progress: 15, message: 'Initializing encoder...' });

    // Create Mediabunny output with WebM format
    const target = new BufferTarget();
    const output = new Output({
      format: new WebMOutputFormat(),
      target,
    });
    muxerOutput = output;

    // Create video packet source — the family actually negotiated above, which
    // is VP8 whenever the VP9 probe failed.
    const videoSource = new EncodedVideoPacketSource(videoCodecFamily);
    output.addVideoTrack(videoSource, { frameRate });

    // Opus, probed independently of video — a browser with no Opus encoder
    // still gets a working, silent WebM, the same way exportMP4.ts drops audio
    // when AAC is unsupported rather than refusing the whole export. And, since
    // ESCSUITE-175's fix round, it **says so**: this used to drop the whole
    // soundtrack behind a `console.warn` and still report `audio: true`, which
    // is the exact defect that ticket fixed on the MP4 side.
    const opusConfig = opusEncoderConfig(sampleRate, EXPORT_AUDIO_CHANNELS, audioBitrate);
    let audioSource: EncodedAudioPacketSource | null = null;
    if (audioData) {
      if (await isAudioCodecSupported(opusConfig)) {
        audioSource = new EncodedAudioPacketSource('opus');
        output.addAudioTrack(audioSource);
      } else {
        audioDropped = true;
        audioData = null;
        log('codec', 'No Opus encoder: exporting without audio');
        onProgress({ phase: 'encoding', progress: 15, message: noAudioNote('webm') });
      }
    }

    // Start the output
    await output.start();

    // Create video encoder with error tracking (ESCSUITE-29: the error
    // callback used to only console.error — nothing ever read the flag it set,
    // so the only way a mid-export encoder failure surfaced was whatever
    // DOMException happened to escape the next call).
    let videoEncoderError: Error | null = null;
    const videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (e) => {
        console.error('Video encoder error:', e);
        videoEncoderError = e instanceof Error ? e : new Error(String(e));
      },
    });

    openEncoders.push(videoEncoder);

    await videoEncoder.configure(videoConfig);

    // Create audio encoder if we have audio
    let audioEncoder: AudioEncoder | null = null;
    let audioEncoderError: Error | null = null;
    if (audioData && audioSource) {
      audioEncoder = new AudioEncoder({
        output: async (chunk, meta) => {
          await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        },
        error: (e) => {
          console.error('Audio encoder error:', e);
          audioEncoderError = e instanceof Error ? e : new Error(String(e));
        },
      });

      openEncoders.push(audioEncoder);

      await audioEncoder.configure(opusConfig);
    }

    onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames...' });
    log('frames', `Starting frame loop: ${totalFrames} total frames at ${frameRate}fps`);

    // Use real-time playback approach for reliable frame capture
    // This plays videos at normal speed and captures frames, avoiding seek issues
    const frameDurationUs = Math.round((1 / frameRate) * 1_000_000);

    // Pause and rewind every source before the frame loop: one seek per element,
    // never part of the per-frame cost.
    const playbackState = rewindElementSources(sources);

    const composeFrame = createFrameComposer({
      ctx,
      canvas,
      clips,
      tracks: exportTracks,
      sources,
      playbackState,
      projectSize,
      outputSize,
      drawOptions,
      frameRate,
    });

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // Check for abort at start of each frame
      checkAborted(signal);

      // Check for an encoder error reported since the last frame (ESCSUITE-29:
      // the asynchronous `error:` callback above can fire between frames with
      // nothing else to notice it).
      if (videoEncoderError) {
        throw videoEncoderError;
      }

      const currentTime = rangeStart + frameIndex / frameRate;

      await composeFrame(currentTime);

      // Create VideoFrame from canvas — timestamp relative to export start (not timeline)
      const exportTime = currentTime - rangeStart;
      const timestamp = Math.round(exportTime * 1_000_000);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: frameDurationUs,
      });

      // Encode frame (keyframe every 2 seconds). ESCSUITE-131: close the frame
      // whether encode() succeeds or throws — mirroring exportMP4.ts's own
      // encode block, which closes the frame on both its success and its
      // fatal-retry paths — so a wedged encoder never leaves a decoded/rendered
      // frame for the GC to finalise on top of the error it just raised.
      const keyFrame = frameCount % frameRate === 0;
      try {
        videoEncoder.encode(frame, { keyFrame });
      } finally {
        frame.close();
      }

      frameCount++;

      // Backpressure: wait for encoder to catch up if queue is too large.
      // This prevents memory exhaustion while allowing smooth encoding, and
      // — ESCSUITE-29 — rethrows an encoder error reported while waiting
      // instead of only the naive queue check, and gives up after 30s of no
      // progress rather than waiting on an encoder that silently wedged.
      await waitForEncoderBackpressure({
        encoder: videoEncoder,
        threshold: 20,
        getError: () => videoEncoderError,
        log,
        exportLog,
        frameIndex,
        totalFrames,
      });

      // Update progress periodically
      if (frameCount % 5 === 0 || frameCount === totalFrames) {
        const progress = 18 + (frameCount / totalFrames) * 70;
        onProgress({
          phase: 'encoding',
          progress: Math.min(progress, 88),
          message: `Encoding frame ${frameCount}/${totalFrames}...`,
        });

        // Yield to prevent UI blocking (uses MessageChannel to avoid background tab throttling)
        await yieldToMain();
      }
    }

    // Encode audio in chunks if available
    if (audioEncoder && audioData) {
      onProgress({ phase: 'encoding', progress: 89, message: 'Encoding audio...' });

      const samplesPerChunk = sampleRate; // 1 second chunks
      const totalSamples = audioData.length / 2; // audioData is interleaved stereo
      const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

      for (let i = 0; i < totalChunks; i++) {
        // Check for abort during audio encoding
        checkAborted(signal);

        const startSample = i * samplesPerChunk;
        const endSample = Math.min((i + 1) * samplesPerChunk, totalSamples);
        const chunkSamples = endSample - startSample;

        // Create planar audio data (left channel first, then right channel)
        const chunkData = new Float32Array(chunkSamples * 2);

        // Left channel (first half)
        for (let s = 0; s < chunkSamples; s++) {
          chunkData[s] = audioData[(startSample + s) * 2]; // Left from interleaved
        }
        // Right channel (second half)
        for (let s = 0; s < chunkSamples; s++) {
          chunkData[chunkSamples + s] = audioData[(startSample + s) * 2 + 1]; // Right from interleaved
        }

        const audioDataObj = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: chunkSamples,
          numberOfChannels: 2,
          timestamp: Math.round((startSample / sampleRate) * 1_000_000),
          data: chunkData,
        });

        audioEncoder.encode(audioDataObj);
        audioDataObj.close();
      }
    }

    log('frames', `Frame loop complete: ${frameCount} frames encoded`);

    // Check for any encoder errors before finalizing
    if (videoEncoderError) {
      log('error', `Video encoder error before finalize: ${(videoEncoderError as Error).message}`);
      throw videoEncoderError;
    }
    if (audioEncoderError) {
      log('error', `Audio encoder error before finalize: ${(audioEncoderError as Error).message}`);
      throw audioEncoderError;
    }

    // Flush and finalize
    onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing WebM...' });

    await videoEncoder.flush();
    videoEncoder.close();

    if (audioEncoder) {
      await audioEncoder.flush();
      audioEncoder.close();
    }

    await output.finalize();

    // A cancel that landed while we were muxing still counts: never hand back
    // an export the caller asked to stop. Thrown before the 'complete' report,
    // so the catch below does the cleanup and rethrows the abort as-is.
    checkAborted(signal);

    // Clean up media elements
    releaseSources();

    onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

    // Get the final buffer
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Export failed: no data was written to buffer');
    }
    // `audio` is false exactly when the Opus probe above refused: this browser
    // cannot carry sound in a WebM. Whether this project *had* any is the
    // dialog's question, not the exporter's — see `ExportResult`.
    return { blob: new Blob([buffer], { type: 'video/webm' }), audio: !audioDropped };
  } catch (error) {
    // Clean up resources on error. The release is the same one the success path
    // made and runs at most once: the two paths are not exclusive — the
    // `complete` report and the empty-buffer refusal both sit after it and both
    // reach here (ESCSUITE-159).
    releaseSources();

    // Close every encoder that was built — none at all when the setup threw
    // before the first one, one when it threw between them (ESCSUITE-156) — and
    // do it *before* the muxer is cancelled (ESCSUITE-159). `close()` abandons
    // the packets an encoder had not delivered yet; cancelling the output first
    // would leave them to arrive at a packet source that now refuses them
    // (`Output has been canceled.`) from inside the `output:` callbacks above,
    // which nobody awaits — an unhandled rejection on top of the failure being
    // reported, on the ordinary path of a user clicking Cancel mid-export.
    // ESCAPECRAFT's recorder `cleanup()` keeps the same order for the same
    // reason.
    for (const encoder of openEncoders) {
      try {
        if (encoder.state !== 'closed') {
          encoder.close();
        }
      } catch { /* ignore */ }
    }

    // Then the muxer, if it is still mid-file. `'started'` is the only state
    // that is: a `'pending'` output never wrote anything, a `'finalized'` one is
    // a finished file whose target `finalize()` already closed (asking anyway
    // only logs "Output has already been finalized."), and a `finalize()` that
    // *rejected* leaves `'canceled'`, which has released what it had. Reading
    // Mediabunny's own state rather than keeping a flag out here is what
    // ESCAPECRAFT's `cleanup()` does, and it cannot drift from the library.
    // A muxer that will not let go is reported to the console and no further:
    // the error this export fails with is its own, not the muxer's.
    if (muxerOutput?.state === 'started') {
      try {
        await muxerOutput.cancel();
      } catch (e) {
        console.warn('The export output could not be cancelled:', e);
      }
    }

    // Re-throw ExportAbortedError and ExportError as-is
    if (error instanceof ExportError || (error instanceof Error && error.name === 'ExportAbortedError')) {
      throw error;
    }

    // Wrap other errors (including the encoder's own `error:` callback,
    // ESCSUITE-29) in ExportError to carry the diagnostic log.
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Export failed: ${message}`);
    throw new ExportError(message, exportLog, frameCount, totalFrames);
  }
}
