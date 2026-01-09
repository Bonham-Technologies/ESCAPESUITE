// Video processing utilities using native browser APIs

import { v4 as uuidv4 } from 'uuid';
import type { SourceVideo } from '../store/types';
import { DEFAULT_IMAGE_DURATION } from '../store/types';
import { storeVideo, storeThumbnail } from './storage';
import { extractWaveformData } from '../utils/waveform';

/**
 * Extract metadata from a video file
 */
export async function extractVideoMetadata(file: File): Promise<SourceVideo> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      const metadata: SourceVideo = {
        id: uuidv4(),
        name: file.name,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        frameRate: 30, // Default, will be updated if we can detect it
        mimeType: file.type,
        size: file.size,
      };

      URL.revokeObjectURL(objectUrl);
      resolve(metadata);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load video: ${file.name}`));
    };
  });
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

  // Generate thumbnail
  try {
    const thumbnail = await generateThumbnail(file);
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
 */
export async function extractAudioMetadata(file: File): Promise<SourceVideo> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';

    const objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;

    audio.onloadedmetadata = () => {
      const metadata: SourceVideo = {
        id: uuidv4(),
        name: file.name,
        duration: audio.duration,
        width: 0, // Audio has no dimensions
        height: 0,
        frameRate: 0, // Not applicable for audio
        mimeType: file.type,
        size: file.size,
        mediaType: 'audio',
      };

      URL.revokeObjectURL(objectUrl);
      resolve(metadata);
    };

    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load audio: ${file.name}`));
    };
  });
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
