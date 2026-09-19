// Video processing utilities using native browser APIs

import { v4 as uuidv4 } from 'uuid';
import type { SourceVideo } from '../store/types';
import { DEFAULT_IMAGE_DURATION } from '../store/types';
import { storeVideo, storeThumbnail } from './storage';
import { extractWaveformData } from '../utils/waveform';

/**
 * Seek target used to make a browser discover a duration it did not read from
 * the container. Browsers clamp a seek to the end of the media, and Chromium
 * scans the file to find that end — which is the only way to learn the length
 * of a WebM written without a Duration element.
 */
const END_SEEK_TARGET = Number.MAX_SAFE_INTEGER;

/** How long to wait for the end seek to report back before giving up. */
const DURATION_PROBE_TIMEOUT_MS = 5000;

/** A duration we can build a clip from: a real, positive number of seconds. */
function isUsableDuration(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Resolve the playable length of a media file, recovering it from the media
 * itself when the container never declared one.
 *
 * A WebM with no Duration/Cues element — raw MediaRecorder output, or an
 * ESCAPECRAFT take whose metadata fix failed — reports `Infinity` (or `0`) on
 * `loadedmetadata`. Rather than accept a clip that is infinitely long, seek
 * past the end so the browser scans the container, and take the first real
 * length it reports: `duration` if it has one, otherwise the position the seek
 * clamped to. If neither arrives, reject — a rejection surfaces through the
 * same path a failed load does.
 *
 * Both importers go through here: the same headerless WebM arrives as a video
 * or as an audio-only take, and the only thing that differs is the word in the
 * failure message. The caller owns the element and creates the object URL;
 * this owns the listeners, the probe's timer, and the single revoke that
 * happens however the promise settles.
 */
function loadMediaDuration(
  element: HTMLMediaElement,
  objectUrl: string,
  name: string,
  kind: 'video' | 'audio'
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Replaced by the end-seek probe with its own teardown: a no-op before there
    // is a probe to stop, and again after one has been stopped. Kept as a
    // variable so `release` can tear a probe down without branching on whether
    // one is running — an `error` after the seek has started must not leave the
    // timer armed, holding the element, the File and the URL for five seconds.
    let stopProbe = () => {};

    // Everything that happens exactly once, on whichever path settles first.
    const release = () => {
      stopProbe();
      // `src` still points at the URL about to be revoked, and some browsers
      // fire 'error' on a dangling src — which would re-enter `fail` and revoke
      // a second time.
      element.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };

    const succeed = (duration: number) => {
      release();
      resolve(duration);
    };

    const fail = (message: string) => {
      release();
      reject(new Error(message));
    };

    const probeDurationBySeekingToEnd = () => {
      const timeout = setTimeout(() => {
        fail(`Could not determine the duration of ${name}`);
      }, DURATION_PROBE_TIMEOUT_MS);

      const onProbe = () => {
        // A browser that has not clamped the seek yet — or that clamps to a
        // `seekable` range whose end is still Infinity mid-scan — reports back
        // the position we asked for. That is a seek target, not a length, and
        // accepting it would put 285 million years into the timeline.
        const position = element.currentTime < END_SEEK_TARGET ? element.currentTime : 0;
        const discovered = isUsableDuration(element.duration) ? element.duration : position;
        // The other event may still carry the answer, so keep waiting rather
        // than resolving with a length that is no better than the one we had.
        if (!isUsableDuration(discovered)) return;
        succeed(discovered);
      };

      // Assigned after everything it tears down exists, and read only from
      // `release` — so no reference here resolves before it is initialised.
      stopProbe = () => {
        clearTimeout(timeout);
        element.removeEventListener('durationchange', onProbe);
        element.removeEventListener('seeked', onProbe);
      };

      element.addEventListener('durationchange', onProbe);
      element.addEventListener('seeked', onProbe);
      element.currentTime = END_SEEK_TARGET;
    };

    element.onloadedmetadata = () => {
      if (isUsableDuration(element.duration)) {
        succeed(element.duration);
        return;
      }
      probeDurationBySeekingToEnd();
    };

    element.onerror = () => {
      fail(`Failed to load ${kind}: ${name}`);
    };
  });
}

/**
 * Extract metadata from a video file
 *
 * The length comes from `loadMediaDuration`, which probes for it when the
 * container declares none; the rest is read off the element once it has
 * settled.
 */
export async function extractVideoMetadata(file: File): Promise<SourceVideo> {
  const video = document.createElement('video');
  video.preload = 'metadata';

  const objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;

  const duration = await loadMediaDuration(video, objectUrl, file.name, 'video');

  return {
    id: uuidv4(),
    name: file.name,
    duration,
    width: video.videoWidth,
    height: video.videoHeight,
    frameRate: 30, // Default, will be updated if we can detect it
    mimeType: file.type,
    size: file.size,
  };
}

/**
 * The duration to use for media already stored in IndexedDB.
 *
 * The `?loadVideo=` handoff from ESCAPECRAFT adds a stored recording straight
 * from its stored metadata, so it never passes through `extractVideoMetadata`.
 * CRAFT prefers the stored value to its own wall clock (its guard is
 * `metadata.duration > 0`, and `Infinity > 0` is true), so a take whose WebM
 * lost its Duration element arrives here with no usable length and would build
 * an infinitely long clip. Recover it from the blob the way an imported file
 * gets one; trust the stored value in every other case, which is the common one.
 */
export async function resolveStoredDuration(blob: Blob, metadata: SourceVideo): Promise<number> {
  if (isUsableDuration(metadata.duration)) {
    return metadata.duration;
  }
  const recovered = await extractVideoMetadata(
    new File([blob], metadata.name, { type: blob.type })
  );
  return recovered.duration;
}

/**
 * Generate a thumbnail from a video at a specific time
 */
export async function generateThumbnail(
  file: File,
  time: number = 0,
  width: number = 160,
  height: number = 90
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      // Seek to the specified time (or 10% into the video if time is 0)
      video.currentTime = time || video.duration * 0.1;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const aspectRatio = video.videoWidth / video.videoHeight;

      // Maintain aspect ratio
      if (aspectRatio > width / height) {
        canvas.width = width;
        canvas.height = width / aspectRatio;
      } else {
        canvas.height = height;
        canvas.width = height * aspectRatio;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to generate thumbnail'));
          }
        },
        'image/jpeg',
        0.8
      );
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load video for thumbnail: ${file.name}`));
    };
  });
}

/**
 * Process and store a video file
 */
export async function processVideoFile(file: File): Promise<SourceVideo> {
  // Extract metadata
  const metadata = await extractVideoMetadata(file);
  metadata.mediaType = 'video';

  // Generate thumbnail. The time is passed explicitly because generateThumbnail
  // loads its own element, which for a file with no duration header reports the
  // same Infinity this metadata was recovered from.
  try {
    const thumbnail = await generateThumbnail(file, metadata.duration * 0.1);
    await storeThumbnail(metadata.id, thumbnail);
    metadata.thumbnailUrl = URL.createObjectURL(thumbnail);
  } catch (error) {
    console.warn('Failed to generate thumbnail:', error);
  }

  // Extract audio waveform data (videos may have audio tracks)
  try {
    const { peaks, hasAudio } = await extractWaveformData(file);
    metadata.waveformData = peaks;
    metadata.hasAudio = hasAudio;
  } catch (error) {
    console.warn('Failed to extract waveform data:', error);
    metadata.hasAudio = false;
  }

  // Store the video blob
  await storeVideo(metadata.id, file, metadata);

  return metadata;
}

/**
 * Extract metadata from an image file
 */
export async function extractImageMetadata(file: File): Promise<SourceVideo> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    img.onload = () => {
      const metadata: SourceVideo = {
        id: uuidv4(),
        name: file.name,
        duration: DEFAULT_IMAGE_DURATION, // Images have a default duration
        width: img.naturalWidth,
        height: img.naturalHeight,
        frameRate: 1, // Static image
        mimeType: file.type,
        size: file.size,
        mediaType: 'image',
      };

      URL.revokeObjectURL(objectUrl);
      resolve(metadata);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
  });
}

/**
 * Generate a thumbnail from an image file
 */
export async function generateImageThumbnail(
  file: File,
  width: number = 160,
  height: number = 90
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const aspectRatio = img.naturalWidth / img.naturalHeight;

      // Maintain aspect ratio
      if (aspectRatio > width / height) {
        canvas.width = width;
        canvas.height = width / aspectRatio;
      } else {
        canvas.height = height;
        canvas.width = height * aspectRatio;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to generate thumbnail'));
          }
        },
        'image/jpeg',
        0.8
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image for thumbnail: ${file.name}`));
    };
  });
}

/**
 * Process and store an image file
 */
export async function processImageFile(file: File): Promise<SourceVideo> {
  // Extract metadata
  const metadata = await extractImageMetadata(file);

  // Generate thumbnail (use the image itself scaled down)
  try {
    const thumbnail = await generateImageThumbnail(file);
    await storeThumbnail(metadata.id, thumbnail);
    metadata.thumbnailUrl = URL.createObjectURL(thumbnail);
  } catch (error) {
    console.warn('Failed to generate thumbnail:', error);
  }

  // Store the image blob
  await storeVideo(metadata.id, file, metadata);

  return metadata;
}

/**
 * Extract metadata from an audio file
 *
 * The length comes from `loadMediaDuration`, the same probe the video importer
 * uses: an ESCAPECRAFT take recorded with no camera is raw MediaRecorder Opus
 * in a WebM with no Duration element, so it reports `Infinity` (or `0`) on
 * `loadedmetadata` here exactly as it does there, and an unchecked read builds
 * an infinitely long audio clip.
 */
export async function extractAudioMetadata(file: File): Promise<SourceVideo> {
  const audio = document.createElement('audio');
  audio.preload = 'metadata';

  const objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;

  const duration = await loadMediaDuration(audio, objectUrl, file.name, 'audio');

  return {
    id: uuidv4(),
    name: file.name,
    duration,
    width: 0, // Audio has no dimensions
    height: 0,
    frameRate: 0, // Not applicable for audio
    mimeType: file.type,
    size: file.size,
    mediaType: 'audio',
  };
}

/**
 * Generate a waveform thumbnail for an audio file
 * Creates a visual representation of the audio waveform
 */
export async function generateAudioThumbnail(
  file: File,
  width: number = 160,
  height: number = 90
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    try {
      // Decode audio to get waveform data
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get audio data from first channel
      const channelData = audioBuffer.getChannelData(0);

      // Create canvas for waveform
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Background
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, 0, width, height);

      // Draw waveform
      const samplesPerPixel = Math.floor(channelData.length / width);
      const centerY = height / 2;

      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let x = 0; x < width; x++) {
        const startSample = x * samplesPerPixel;
        const endSample = startSample + samplesPerPixel;

        // Find min and max in this segment
        let min = 0;
        let max = 0;
        for (let i = startSample; i < endSample && i < channelData.length; i++) {
          if (channelData[i] < min) min = channelData[i];
          if (channelData[i] > max) max = channelData[i];
        }

        // Draw vertical line for this segment
        const minY = centerY + (min * centerY * 0.9);
        const maxY = centerY + (max * centerY * 0.9);

        ctx.moveTo(x, minY);
        ctx.lineTo(x, maxY);
      }

      ctx.stroke();

      // Add audio icon overlay
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', width / 2, height / 2);

      await audioContext.close();

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to generate audio thumbnail'));
          }
        },
        'image/jpeg',
        0.8
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Process and store an audio file
 */
export async function processAudioFile(file: File): Promise<SourceVideo> {
  // Extract metadata
  const metadata = await extractAudioMetadata(file);

  // Generate waveform thumbnail
  try {
    const thumbnail = await generateAudioThumbnail(file);
    await storeThumbnail(metadata.id, thumbnail);
    metadata.thumbnailUrl = URL.createObjectURL(thumbnail);
  } catch (error) {
    console.warn('Failed to generate audio thumbnail:', error);
  }

  // Extract waveform data for timeline visualization
  try {
    const { peaks, hasAudio } = await extractWaveformData(file);
    metadata.waveformData = peaks;
    metadata.hasAudio = hasAudio;
  } catch (error) {
    console.warn('Failed to extract waveform data:', error);
    metadata.hasAudio = true; // Assume audio file has audio
  }

  // Store the audio blob
  await storeVideo(metadata.id, file, metadata);

  return metadata;
}

/**
 * Create an object URL for a video ID
 */
export async function createVideoUrl(videoId: string): Promise<string | null> {
  const { getVideoBlob } = await import('./storage');
  const blob = await getVideoBlob(videoId);
  if (blob) {
    return URL.createObjectURL(blob);
  }
  return null;
}

/**
 * Check if WebCodecs API is available
 */
export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

/**
 * Get supported video codecs
 */
export async function getSupportedCodecs(): Promise<{
  encode: string[];
  decode: string[];
}> {
  const encodeCodecs: string[] = [];
  const decodeCodecs: string[] = [];

  if (!isWebCodecsSupported()) {
    return { encode: encodeCodecs, decode: decodeCodecs };
  }

  // Common codec strings to test
  const codecsToTest = [
    'avc1.42E01E', // H.264 Baseline
    'avc1.4D401E', // H.264 Main
    'avc1.64001E', // H.264 High
    'vp8',
    'vp09.00.10.08', // VP9
  ];

  for (const codec of codecsToTest) {
    try {
      const encodeSupport = await VideoEncoder.isConfigSupported({
        codec,
        width: 1920,
        height: 1080,
        framerate: 30,
        bitrate: 5_000_000,
      });
      if (encodeSupport.supported) {
        encodeCodecs.push(codec);
      }
    } catch {
      // Codec not supported for encoding
    }

    try {
      const decodeSupport = await VideoDecoder.isConfigSupported({
        codec,
        codedWidth: 1920,
        codedHeight: 1080,
      });
      if (decodeSupport.supported) {
        decodeCodecs.push(codec);
      }
    } catch {
      // Codec not supported for decoding
    }
  }

  return { encode: encodeCodecs, decode: decodeCodecs };
}
