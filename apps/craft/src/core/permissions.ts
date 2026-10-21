// Permission and capability detection for recording features

import { CAPTURE_FRAME_RATE } from './captureFrameRate';
import type {
  EnvironmentCapabilities,
  DetailedCapabilities,
  CapabilityInfo,
  CapabilityUnavailableReason
} from '../store/types';

/** Result of capability detection */
export interface CapabilityDetectionResult {
  capabilities: EnvironmentCapabilities;
  detailed: DetailedCapabilities;
}

/**
 * Check if running in a secure context (HTTPS or localhost)
 */
function isSecureContext(): boolean {
  return window.isSecureContext ??
    (location.protocol === 'https:' || location.hostname === 'localhost');
}

/**
 * Get browser name for browser-specific capability checks
 */
function getBrowserName(): 'chrome' | 'firefox' | 'safari' | 'edge' | 'other' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('chrome')) return 'chrome';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'safari';
  return 'other';
}

/**
 * Check permission state using the Permissions API (where available)
 */
async function checkPermissionState(
  name: 'camera' | 'microphone'
): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (!navigator.permissions?.query) {
      return 'unknown';
    }
    const result = await navigator.permissions.query({ name: name as PermissionName });
    return result.state as 'granted' | 'denied' | 'prompt';
  } catch {
    // Permission query not supported for this permission
    return 'unknown';
  }
}

/**
 * Create a capability info object for an available capability
 */
function available(): CapabilityInfo {
  return { available: true };
}

/**
 * Create a capability info object for an unavailable capability
 */
function unavailable(reason: CapabilityUnavailableReason, message: string): CapabilityInfo {
  return { available: false, reason, message };
}

/**
 * Detect available recording capabilities in the current environment.
 * Returns both simple boolean capabilities and detailed info with reasons.
 */
export async function detectCapabilities(): Promise<CapabilityDetectionResult> {
  const capabilities: EnvironmentCapabilities = {
    screenCapture: false,
    webcam: false,
    microphone: false,
    systemAudio: false,
    mediaRecorder: false,
  };

  const detailed: DetailedCapabilities = {
    screenCapture: unavailable('api_not_supported', 'Screen capture is not supported'),
    webcam: unavailable('api_not_supported', 'Webcam is not supported'),
    microphone: unavailable('api_not_supported', 'Microphone is not supported'),
    systemAudio: unavailable('browser_not_supported', 'System audio is not supported'),
    mediaRecorder: unavailable('api_not_supported', 'Recording is not supported'),
  };

  const browser = getBrowserName();

  // Check secure context first - required for all media APIs
  if (!isSecureContext()) {
    const message = 'Recording requires a secure connection (HTTPS)';
    detailed.screenCapture = unavailable('not_secure_context', message);
    detailed.webcam = unavailable('not_secure_context', message);
    detailed.microphone = unavailable('not_secure_context', message);
    detailed.systemAudio = unavailable('not_secure_context', message);
    detailed.mediaRecorder = unavailable('not_secure_context', message);
    return { capabilities, detailed };
  }

  // Check MediaRecorder API
  if (typeof MediaRecorder !== 'undefined') {
    capabilities.mediaRecorder = true;
    detailed.mediaRecorder = available();
  } else {
    detailed.mediaRecorder = unavailable('api_not_supported', 'Your browser does not support recording');
  }

  // Check getDisplayMedia (screen capture)
  if (navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices) {
    capabilities.screenCapture = true;
    detailed.screenCapture = available();

    // System audio is only available in Chromium browsers (Chrome, Edge)
    if (browser === 'chrome' || browser === 'edge') {
      capabilities.systemAudio = true;
      detailed.systemAudio = available();
    } else if (browser === 'firefox') {
      detailed.systemAudio = unavailable(
        'browser_not_supported',
        'System audio capture is not supported in Firefox'
      );
    } else if (browser === 'safari') {
      detailed.systemAudio = unavailable(
        'browser_not_supported',
        'System audio capture is not supported in Safari'
      );
    } else {
      detailed.systemAudio = unavailable(
        'browser_not_supported',
        'System audio capture may not be supported in your browser'
      );
    }
  } else {
    detailed.screenCapture = unavailable(
      'api_not_supported',
      'Screen capture is not supported in your browser'
    );
  }

  // Check getUserMedia (webcam/microphone)
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    // Check permission states
    const [cameraPermission, micPermission] = await Promise.all([
      checkPermissionState('camera'),
      checkPermissionState('microphone'),
    ]);

    // Check for actual devices
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideoDevice = devices.some((d) => d.kind === 'videoinput');
      const hasAudioDevice = devices.some((d) => d.kind === 'audioinput');

      // Webcam capability
      if (cameraPermission === 'denied') {
        detailed.webcam = unavailable(
          'permission_denied',
          'Camera access was denied. Check your browser settings.'
        );
      } else if (!hasVideoDevice) {
        detailed.webcam = unavailable('no_device', 'No camera found on this device');
      } else {
        capabilities.webcam = true;
        detailed.webcam = available();
      }

      // Microphone capability
      if (micPermission === 'denied') {
        detailed.microphone = unavailable(
          'permission_denied',
          'Microphone access was denied. Check your browser settings.'
        );
      } else if (!hasAudioDevice) {
        detailed.microphone = unavailable('no_device', 'No microphone found on this device');
      } else {
        capabilities.microphone = true;
        detailed.microphone = available();
      }
    } catch (error) {
      // enumerateDevices failed - could be policy blocked
      if (error instanceof Error && error.name === 'NotAllowedError') {
        detailed.webcam = unavailable(
          'policy_blocked',
          'Camera access is blocked by browser policy'
        );
        detailed.microphone = unavailable(
          'policy_blocked',
          'Microphone access is blocked by browser policy'
        );
      } else {
        // Assume capabilities exist if we can't check
        capabilities.webcam = true;
        capabilities.microphone = true;
        detailed.webcam = available();
        detailed.microphone = available();
      }
    }
  } else {
    detailed.webcam = unavailable(
      'api_not_supported',
      'Camera access is not supported in your browser'
    );
    detailed.microphone = unavailable(
      'api_not_supported',
      'Microphone access is not supported in your browser'
    );
  }

  return { capabilities, detailed };
}

/** The three sources a take can ask the browser for. */
export type CaptureSource = 'screen' | 'webcam' | 'microphone';

/**
 * A capture request that failed, tagged with the source it was for
 * (ESCSUITE-341).
 *
 * Every rejection from `requestScreenCapture`/`requestWebcam`/
 * `requestMicrophone` leaves as one of these — not only the two names each
 * maps to a message of its own — with whatever the browser rejected with
 * carried, untouched, as `cause`. The start path needs both halves: the
 * `source` to say *which* request failed (a camera refused after the user has
 * already answered the share picker must not read as the screen share
 * failing), and the browser's own `DOMException` name, read through `cause`,
 * to say *how* (refused, or not there / in use). Tagging here, where each
 * request is already wrapped, is the one place that knows the source for
 * certain; `acquireStreams` asks for three things in a row and its catch
 * cannot tell them apart.
 */
export class CaptureRequestError extends Error {
  readonly source: CaptureSource;

  constructor(source: CaptureSource, message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = 'CaptureRequestError';
    this.source = source;
  }
}

/**
 * Rethrow a capture request's rejection as a `CaptureRequestError` for
 * `source`. The two names worth a message of their own keep the messages they
 * always had; anything else — `NotReadableError`, `OverconstrainedError`, a
 * non-`Error` rejection — gets the source's generic one.
 */
function captureRequestFailed(
  source: CaptureSource,
  error: unknown,
  messages: { NotAllowedError: string; NotFoundError: string; other: string }
): never {
  const name = error instanceof Error ? error.name : undefined;
  const message =
    name === 'NotAllowedError' || name === 'NotFoundError' ? messages[name] : messages.other;
  throw new CaptureRequestError(source, message, { cause: error });
}

/**
 * Request screen capture with optional system audio.
 * Returns the MediaStream or throws a `CaptureRequestError` tagged `'screen'`.
 *
 * Note: Uses constraints to improve capture experience:
 * - selfBrowserSurface: "exclude" prevents selecting the CRAFT tab
 * - preferCurrentTab: false discourages selecting current tab
 * - monitorTypeSurfaces: "include" enables monitor/screen selection
 */
export async function requestScreenCapture(
  withSystemAudio: boolean
): Promise<MediaStream> {
  // Build video constraints with display surface preferences
  // These help guide users to select appropriate capture sources
  const videoConstraints: MediaTrackConstraints & {
    displaySurface?: string;
  } = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: CAPTURE_FRAME_RATE },
  };

  // Extended constraints for better capture source selection
  // These are Chrome-specific but gracefully ignored by other browsers
  const extendedConstraints: DisplayMediaStreamOptions & {
    selfBrowserSurface?: string;
    preferCurrentTab?: boolean;
    monitorTypeSurfaces?: string;
    surfaceSwitching?: string;
  } = {
    video: videoConstraints,
    audio: withSystemAudio,
    // Exclude the current tab (CRAFT) from selection options
    selfBrowserSurface: 'exclude',
    // Don't prefer the current tab
    preferCurrentTab: false,
    // Include monitor/screen options in picker
    monitorTypeSurfaces: 'include',
    // Allow surface switching during capture (e.g., if user switches windows)
    surfaceSwitching: 'include',
  };

  try {
    return await navigator.mediaDevices.getDisplayMedia(extendedConstraints);
  } catch (error) {
    captureRequestFailed('screen', error, {
      NotAllowedError: 'Screen capture permission denied',
      NotFoundError: 'No screen available for capture',
      other: 'Screen capture failed',
    });
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
      frameRate: { ideal: CAPTURE_FRAME_RATE },
    },
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    captureRequestFailed('webcam', error, {
      NotAllowedError: 'Webcam permission denied',
      NotFoundError: 'No webcam found',
      other: 'Webcam could not be opened',
    });
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
    captureRequestFailed('microphone', error, {
      NotAllowedError: 'Microphone permission denied',
      NotFoundError: 'No microphone found',
      other: 'Microphone could not be opened',
    });
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
