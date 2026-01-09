// Permission and capability detection for recording features

import type { EnvironmentCapabilities } from '../store/types';

/**
 * Detect available recording capabilities in the current environment.
 * This doesn't request permissions, just checks API availability.
 */
export async function detectCapabilities(): Promise<EnvironmentCapabilities> {
  const capabilities: EnvironmentCapabilities = {
    screenCapture: false,
    webcam: false,
    microphone: false,
    systemAudio: false,
    mediaRecorder: false,
  };

  // Check MediaRecorder API
  capabilities.mediaRecorder = typeof MediaRecorder !== 'undefined';

  // Check getDisplayMedia (screen capture)
  if (navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices) {
    capabilities.screenCapture = true;
    // System audio is available with screen capture in some browsers
    capabilities.systemAudio = true; // Will be validated when actually capturing
  }

  // Check getUserMedia (webcam/microphone)
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    try {
      // Check for video devices (webcam)
      const devices = await navigator.mediaDevices.enumerateDevices();
      capabilities.webcam = devices.some((d) => d.kind === 'videoinput');
      capabilities.microphone = devices.some((d) => d.kind === 'audioinput');
    } catch {
      // enumerateDevices failed, assume capabilities exist
      capabilities.webcam = true;
      capabilities.microphone = true;
    }
  }

  return capabilities;
}

/**
 * Request screen capture with optional system audio.
 * Returns the MediaStream or throws an error.
 */
export async function requestScreenCapture(
  withSystemAudio: boolean
): Promise<MediaStream> {
  const constraints: DisplayMediaStreamOptions = {
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: withSystemAudio,
  };

  try {
    return await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen capture permission denied');
      }
      if (error.name === 'NotFoundError') {
        throw new Error('No screen available for capture');
      }
    }
    throw error;
  }
}

/**
 * Request webcam access.
 */
export async function requestWebcam(): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Webcam permission denied');
      }
      if (error.name === 'NotFoundError') {
        throw new Error('No webcam found');
      }
    }
    throw error;
  }
}

/**
 * Request microphone access.
 */
export async function requestMicrophone(): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: false,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Microphone permission denied');
      }
      if (error.name === 'NotFoundError') {
        throw new Error('No microphone found');
      }
    }
    throw error;
  }
}

/**
 * Stop all tracks in a MediaStream.
 */
export function stopStream(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Check if system audio is actually available in the display stream.
 */
export function hasSystemAudio(stream: MediaStream): boolean {
  return stream.getAudioTracks().length > 0;
}

/**
 * Get the best supported MIME type for MediaRecorder.
 */
export function getSupportedMimeType(): string {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return 'video/webm';
}
