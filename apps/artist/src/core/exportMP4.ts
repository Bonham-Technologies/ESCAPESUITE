// MP4 export via WebCodecs + Mediabunny
// H.264 video + AAC audio, frame-by-frame encoding with WebCodecs decoding

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';
import type { Clip, SourceVideo, Track, ExportOptions } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getVideoBlob } from './storage';
import { getClipsAtTime } from '../store/projectStore';
import { getAnimatedValues } from '../utils/animation';
import { isWebCodecsAvailable } from './frameSource';
import type { DrawableMediaSource, MediaDrawOptions, ProgressCallback, ExportLogEntry } from './exportTypes';
import { openOutputFrame, projectToOutputScale } from './outputTransform';
import {
  checkAborted,
  hasMP4EncodeGlobals,
  getQualitySettings,
  getResolution, getBaseDimensions,
  loadImageElement,
  yieldToMain,
  calculateTimelineDuration,
  assertExportableLength,
  getActiveTransition,
  findSupportedVideoConfig,
  mp4VideoCodecConfigs,
  aacEncoderConfig,
  isAudioCodecSupported,
  waitForEncoderBackpressure,
  ExportError,
  EXPORT_AUDIO_CHANNELS,
  EXPORT_AUDIO_SAMPLE_RATE,
  noAudioNote,
  MP4_NO_CODEC_REASON,
} from './exportTypes';
import type { ExportResult } from './exportTypes';
import {
  drawMediaWithFrame,
  drawTransitionWithFrames,
  drawTextOverlayToCanvasAnimated,
  drawShapeOverlayToCanvasAnimated,
} from './canvasRenderer';
import {
  createFrameManager,
  loadFrameSource,
  getFrameAtTime,
  cleanupIterationFrames,
  disposeFrameManager,
} from './frameManager';
import { extractAndMixAudio } from './audioMixer';

// `ExportLogEntry` and `ExportError` live in exportTypes.ts (moved there by
// ESCSUITE-152, independently of ESCSUITE-29 Mechanism 1 doing the same
// thing on this branch), so exportWebM.ts can import them without reaching
// into this module; re-exported here so every existing
// `import { ExportError } from './exportMP4'` (and the `exporter.ts` barrel,
// which re-exports from here) keeps resolving unchanged.
export type { ExportLogEntry } from './exportTypes';
export { ExportError } from './exportTypes';

/**
 * Export timeline to MP4 using WebCodecs + Mediabunny
 * Frame-by-frame encoding with H.264 video and AAC audio.
 *
 * Both codecs are asked about **before** any of the work (ESCSUITE-175): the
 * H.264 ladder used to be walked only after the whole timeline's audio had been
 * mixed, every source loaded and the muxer started, and the AAC probe sat even
 * later, where a refusal dropped the soundtrack behind a `console.warn` and the
 * export still reported "Export complete!". Now a missing H.264 refuses up front
 * with the dialog's own sentence, and a missing AAC is reported through
 * `onProgress` and carried out in the result's `audio: false`.
 */
export async function exportToMP4(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  signal?: AbortSignal,
  projectResolution?: { width: number; height: number }
): Promise<ExportResult> {
  if (!hasMP4EncodeGlobals()) {
    throw new Error('MP4 export requires WebCodecs API (Chrome/Edge)');
  }

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Check for early abort
  checkAborted(signal);

  // Diagnostic logging for debugging export failures
  const exportLog: ExportLogEntry[] = [];
  const log = (phase: string, detail: string) => {
    exportLog.push({ phase, detail, timestamp: performance.now() });
  };

  log('init', `Starting MP4 export with ${clips.length} clips`);

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing MP4 export...' });

  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  // Use the bottom-most track's source dimensions as the base
  const { width: baseWidth, height: baseHeight } = getBaseDimensions(clips, exportTracks, sourceVideos);
  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight, projectResolution);

  // Defensive guard at the door (ESCSUITE-152): `parseProject` rejects a
  // malformed project `resolution` before it ever reaches the store, but a
  // caller that builds `ExportOptions`/`projectResolution` by hand — a
  // headless job spec, today's only other caller — has no such gate, and
  // `VideoEncoder.configure` rejects a 0x0 (or non-finite) raster far less
  // clearly than this does.
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
  assertExportableLength(calculateTimelineDuration(clips), 'mp4', exportLog);
  // And the length that will actually be encoded: a selected range's own.
  if (options.timeRange) {
    assertExportableLength(options.timeRange.end - options.timeRange.start, 'mp4', exportLog);
  }

  // Ask both codecs before spending anything (ESCSUITE-175). The ladder walker
  // and the candidate list are the ones the export dialog's own up-front probe
  // uses, at this export's real bitrate and frame rate, so the answer here and
  // the answer the user was shown cannot differ on which codecs exist.
  const foundVideoConfig = await findSupportedVideoConfig(
    mp4VideoCodecConfigs(width, height, videoBitrate, frameRate)
  );
  if (!foundVideoConfig) {
    log('codec', 'No supported H.264 configuration at any profile or acceleration mode');
    // The dialog's own sentence, so a refusal reads the same before the click
    // and after it — and an `ExportError`, so it carries the trail and reaches
    // the dialog's diagnosed-codec-failure path rather than its generic one.
    throw new ExportError(MP4_NO_CODEC_REASON, exportLog);
  }

  // Log the candidate we asked about, not `found.config` — the browser's own
  // normalised answer is not guaranteed to echo it (review round 1, NIT 3),
  // and the candidate is what this ladder actually chose.
  const { config: videoConfig, candidate: videoCandidate } = foundVideoConfig;
  log(
    'codec',
    `Selected H.264 codec: ${videoCandidate.codec} hw=${videoCandidate.hardwareAcceleration} (${width}x${height} @ ${videoBitrate}bps)`
  );
  console.log(`[MP4 Export] Using H.264 codec: ${videoCandidate.codec} (${videoCandidate.hardwareAcceleration})`);

  // And the audio codec, before the mix rather than after it. A browser with no
  // AAC encoder cannot carry this project's sound however long we spend mixing
  // it, so the mix is skipped outright and the user is told now — not left to
  // discover a silent file.
  const aacConfig = aacEncoderConfig(sampleRate, EXPORT_AUDIO_CHANNELS, audioBitrate);
  const aacSupported = await isAudioCodecSupported(aacConfig);
  if (!aacSupported) {
    log('codec', 'No AAC encoder: exporting without audio');
    onProgress({ phase: 'preparing', progress: 1, message: noAudioNote('mp4') });
  }

  // The space every draw call below is in, as against the raster they land on —
  // see `core/outputTransform`. A caller with no project resolution (only the
  // tests, today) gets the base dimensions, the same stand-in `getResolution`
  // uses for 'project'.
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

  // Extract and mix audio first, on the main thread — but only when there is an
  // encoder that could carry it.
  // Note: we extract the full timeline audio, then slice it later
  let fullAudioData: Float32Array | null = null;
  if (aacSupported) {
    onProgress({ phase: 'preparing', progress: 2, message: 'Extracting audio...' });

    log('audio', 'Starting audio extraction');
    fullAudioData = await extractAndMixAudio(clips, exportTracks, fullDuration, (p) => {
      onProgress({ phase: 'preparing', progress: 2 + p * 0.08, message: 'Extracting audio...' });
    });
    log('audio', fullAudioData ? `Audio extracted: ${fullAudioData.length} samples` : 'No audio data');
  }

  // Slice audio to the selected time range
  // Audio is stereo interleaved (2 channels), so multiply sample indices by 2
  const audioChannels = EXPORT_AUDIO_CHANNELS;
  const audioData: Float32Array | null = fullAudioData && options.timeRange ? (() => {
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
  // Use WebCodecs-based frame decoding when available for background-capable export
  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  // Create frame manager - uses WebCodecs when available, falls back to HTMLVideoElement.
  // signal lets a cancelled export interrupt the decode worker's startup wait
  // instead of sitting through its full timeout (ESCSUITE-29 Mechanism 2).
  const frameManager = await createFrameManager(isWebCodecsAvailable(), signal);
  const imageElements: Map<string, HTMLImageElement> = new Map();

  // Log which mode we're using
  if (frameManager.useWebCodecs) {
    console.log('[MP4 Export] Using WebCodecs for video decoding (background-capable)');
  } else {
    console.log('[MP4 Export] Using HTMLVideoElement for video decoding (standard mode)');
    // Tell the user: the dialog's own copy promises background-tab encoding,
    // which only holds when WebCodecs actually decoded this export — not when
    // the decode worker could not start (ESCSUITE-153 / ESCSUITE-29
    // Mechanism 2) or WebCodecs/Worker was never available in the first
    // place. Without this, the only signal of the degraded path is a
    // console.warn nobody but a developer will see.
    onProgress({
      phase: 'preparing',
      progress: 12,
      message: 'Decoding in the page; keep this tab in the foreground',
    });
  }

  // Get unique source IDs, filtering out empty ones (overlay clips have no sourceVideoId)
  const uniqueSourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id && id.length > 0))];

  for (const sourceId of uniqueSourceIds) {
    const source = sourceMap.get(sourceId);
    const blob = await getVideoBlob(sourceId);

    if (blob) {
      if (source?.mediaType === 'image') {
        // Load as image
        const img = await loadImageElement(blob);
        imageElements.set(sourceId, img);
      } else if (source?.mediaType !== 'audio') {
        // Load as video using frame manager (supports WebCodecs or HTMLVideoElement)
        try {
          await loadFrameSource(frameManager, sourceId, blob, blob.type || 'video/mp4');
        } catch (e) {
          console.warn(`Failed to load video ${sourceId}, trying as image:`, e);
          // Try loading as image as fallback
          try {
            const img = await loadImageElement(blob);
            imageElements.set(sourceId, img);
          } catch {
            console.warn(`Failed to load media ${sourceId}`);
          }
        }
      }
    }
  }

  onProgress({ phase: 'encoding', progress: 15, message: 'Initializing encoder...' });

  // Create Mediabunny output with MP4 format
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: 'in-memory',
    }),
    target,
  });

  // Create video packet source
  const videoSource = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(videoSource, { frameRate });

  // Create audio packet source if we have audio. AAC was probed before the mix
  // ran (above), so reaching here with audio data means the encoder exists.
  let audioSource: EncodedAudioPacketSource | null = null;
  if (audioData) {
    audioSource = new EncodedAudioPacketSource('aac');
    output.addAudioTrack(audioSource);
  }

  // Start the output
  await output.start();

  // Create video encoder with error tracking
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

    await audioEncoder.configure(aacConfig);
  }

  // WebCodecs-based frame fetching runs at full speed (no browser throttling)
  const frameDurationUs = Math.round((1 / frameRate) * 1_000_000);
  let frameCount = 0;

  // Helper to clean up resources on abort or completion
  const cleanup = async () => {
    // Clean up any remaining iteration frames
    cleanupIterationFrames(frameManager);

    // Dispose frame manager (closes VideoFrames and frame sources)
    await disposeFrameManager(frameManager);

    // Clean up image elements
    imageElements.forEach((img) => {
      URL.revokeObjectURL(img.src);
    });
  };

  onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames...' });
  log('frames', `Starting frame loop: ${totalFrames} total frames at ${frameRate}fps`);

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // Check for abort at start of each frame
      checkAborted(signal);

      // Clean up frames from previous iteration before starting new one
      cleanupIterationFrames(frameManager);

      // Check for encoder errors at start of each frame
      if (videoEncoderError) {
        throw videoEncoderError;
      }

      const currentTime = rangeStart + frameIndex / frameRate;

      // Check for active transition
      const activeTransition = getActiveTransition(clips, exportTracks, currentTime);

      // Get all clips at current time
      const activeClips = getClipsAtTime(clips, exportTracks, currentTime);

      // Clear the raster to black and put the context in project pixels: every
      // draw below is project-space, exactly as the preview's is.
      openOutputFrame(ctx, projectSize, outputSize);

      // Media clips need a decoded frame fetched (async, below) before anything
      // can be drawn; overlays don't. `activeClips` itself — `getClipsAtTime`'s
      // result — is already sorted by track index, and stays the single source
      // of composite order: see the draw loop below.
      const mediaClips: typeof activeClips = [];

      for (const clipData of activeClips) {
        if (!clipData.clip.overlayType) {
          mediaClips.push(clipData);
        }
      }

      // Helper to calculate clip time
      const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

      // Fetch frames for all active media clips (runs at full speed with WebCodecs)
      const framePromises: Array<{ clip: Clip; clipTime: number; framePromise: Promise<DrawableMediaSource | null> }> = [];

      for (const { clip, clipTime } of mediaClips) {
        // Check if this is a video source (in frameManager.sources)
        const sourceTime = clip.startTime + clipTime;
        if (frameManager.sources.has(clip.sourceVideoId)) {
          framePromises.push({
            clip,
            clipTime,
            framePromise: getFrameAtTime(frameManager, clip.sourceVideoId, sourceTime),
          });
        } else if (imageElements.has(clip.sourceVideoId)) {
          // Image - resolve immediately
          const img = imageElements.get(clip.sourceVideoId)!;
          framePromises.push({
            clip,
            clipTime,
            framePromise: Promise.resolve(img),
          });
        }
      }

      // Also fetch frames for transition clips if active
      let outgoingFrame: DrawableMediaSource | null = null;
      let incomingFrame: DrawableMediaSource | null = null;

      if (activeTransition) {
        const outClipTime = currentTime - activeTransition.outgoingClip.timelinePosition;
        const outSourceTime = activeTransition.outgoingClip.startTime + outClipTime;

        const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
        const inClipTime = currentTime - clipEnd;
        const inSourceTime = inClipTime >= 0
          ? activeTransition.incomingClip.startTime + inClipTime
          : activeTransition.incomingClip.startTime;

        // Fetch outgoing frame
        if (frameManager.sources.has(activeTransition.outgoingClip.sourceVideoId)) {
          outgoingFrame = await getFrameAtTime(frameManager, activeTransition.outgoingClip.sourceVideoId, outSourceTime);
        } else if (imageElements.has(activeTransition.outgoingClip.sourceVideoId)) {
          outgoingFrame = imageElements.get(activeTransition.outgoingClip.sourceVideoId)!;
        }

        // Fetch incoming frame
        if (frameManager.sources.has(activeTransition.incomingClip.sourceVideoId)) {
          incomingFrame = await getFrameAtTime(frameManager, activeTransition.incomingClip.sourceVideoId, inSourceTime);
        } else if (imageElements.has(activeTransition.incomingClip.sourceVideoId)) {
          incomingFrame = imageElements.get(activeTransition.incomingClip.sourceVideoId)!;
        }
      }

      // Wait for all regular clip frames
      const frames = await Promise.all(
        framePromises.map(async ({ clip, clipTime, framePromise }) => ({
          clip,
          clipTime,
          frame: await framePromise,
        }))
      );

      // Composite media and overlay clips in one pass, in `activeClips`' own
      // track order — the same single interleaved pass the preview draws
      // (`components/Preview/drawFrame.ts`), so an overlay on a lower track
      // than a media clip is exactly as hidden behind it here as it is on
      // screen, and a blur shape only reaches the content actually below it.
      const frameByClipId = new Map(
        frames.map(({ clip, clipTime, frame }) => [clip.id, { clipTime, frame }])
      );

      for (const { clip } of activeClips) {
        // Skip clips that are part of an active transition
        if (activeTransition &&
            (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
          continue;
        }

        if (!clip.overlayType) {
          const media = frameByClipId.get(clip.id);
          if (media?.frame) {
            drawMediaWithFrame(
              ctx, media.frame, clip, media.clipTime, projectSize.width, projectSize.height, undefined, drawOptions
            );
          }
          continue;
        }

        const overlayClipTime = getClipTime(clip);

        // Build base transform from overlay's own properties
        let baseTransform = clip.transform || DEFAULT_TRANSFORM;

        if (clip.overlayType === 'text' && clip.textData) {
          baseTransform = {
            ...DEFAULT_TRANSFORM,
            ...clip.transform,
            x: clip.textData.x,
            y: clip.textData.y,
            scaleX: clip.textData.scale ?? 1,
            scaleY: clip.textData.scale ?? 1,
            rotation: clip.textData.rotation ?? 0,
          };
        } else if (clip.overlayType === 'shape' && clip.shapeData) {
          baseTransform = {
            ...DEFAULT_TRANSFORM,
            ...clip.transform,
            x: clip.shapeData.x,
            y: clip.shapeData.y,
            rotation: clip.shapeData.rotation,
          };
        }

        const animated = getAnimatedValues(
          overlayClipTime,
          clip.duration,
          clip.animation,
          baseTransform,
          clip.effects || DEFAULT_EFFECTS
        );

        if (clip.overlayType === 'shape' && clip.shapeData) {
          drawShapeOverlayToCanvasAnimated(
            ctx, clip.shapeData, projectSize.width, projectSize.height, animated, canvas,
            undefined, drawOptions.filterScale
          );
        } else if (clip.overlayType === 'text' && clip.textData) {
          drawTextOverlayToCanvasAnimated(
            ctx, clip.textData, projectSize.width, projectSize.height, animated, drawOptions.filterScale
          );
        }
      }

      // Draw transition if active
      if (activeTransition) {
        drawTransitionWithFrames(
          ctx, outgoingFrame, incomingFrame, activeTransition, currentTime,
          projectSize.width, projectSize.height, drawOptions
        );
      }

      // Create VideoFrame from canvas — timestamp relative to export start (not timeline)
      const exportTime = currentTime - rangeStart;
      const timestamp = Math.round(exportTime * 1_000_000);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: frameDurationUs,
      });

      // Encode frame (keyframe every 2 seconds) with single retry
      const keyFrame = frameCount % (frameRate * 2) === 0;
      try {
        videoEncoder.encode(frame, { keyFrame });
      } catch (encodeErr) {
        log('retry', `Frame ${frameIndex} encode failed, retrying as keyframe: ${encodeErr}`);
        try {
          videoEncoder.encode(frame, { keyFrame: true });
        } catch (retryErr) {
          frame.close();
          log('fatal', `Frame ${frameIndex} retry failed: ${retryErr}`);
          throw new ExportError(
            `Export failed at frame ${frameIndex}/${totalFrames}`,
            exportLog,
            frameIndex,
            totalFrames
          );
        }
      }
      frame.close();

      frameCount++;

      // Log progress every 10th frame
      if (frameCount % 10 === 0) {
        log('progress', `Encoded frame ${frameCount}/${totalFrames}`);
      }

      // Backpressure: wait for encoder to catch up if queue is too large.
      // Shared with exportWebM.ts's own wait (review round 1, MINOR 1) rather
      // than keeping a second copy of the same loop — same mid-wait error
      // check, same 30s stuck-encoder timeout, same ExportError — differing
      // only in MP4's own tighter queue threshold.
      await waitForEncoderBackpressure({
        encoder: videoEncoder,
        threshold: 5,
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
    onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing MP4...' });

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
    await cleanup();

    onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

    // Get the final buffer
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Export failed: no data was written to buffer');
    }
    // `audio` reports whether this browser could carry sound at all, which here
    // is exactly "was there an AAC encoder". Whether this project *had* any is a
    // question the exporter deliberately cannot answer — knowing would mean
    // decoding, which is the cost the probe-first ordering removed — so the
    // dialog pairs this with its own `projectHasAudio` before claiming a loss.
    return { blob: new Blob([buffer], { type: 'video/mp4' }), audio: aacSupported };
  } catch (error) {
    // Clean up resources on error
    await cleanup();

    // Close encoders if they exist
    try {
      if (videoEncoder.state !== 'closed') {
        videoEncoder.close();
      }
    } catch { /* ignore */ }

    try {
      if (audioEncoder && audioEncoder.state !== 'closed') {
        audioEncoder.close();
      }
    } catch { /* ignore */ }

    // Re-throw ExportAbortedError and ExportError as-is
    if (error instanceof ExportError || (error instanceof Error && error.name === 'ExportAbortedError')) {
      throw error;
    }

    // Wrap other errors in ExportError to carry the diagnostic log
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Export failed: ${message}`);
    throw new ExportError(message, exportLog, frameCount, totalFrames);
  }
}
