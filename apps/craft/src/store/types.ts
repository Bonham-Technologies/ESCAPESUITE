// Types shared with ESCAPEARTIST - imported from shared package
export type {
  MediaType,
  MediaSource,
  SourceVideo,
} from '@escapesuite/shared/types'

// Recording-specific types

export type RecordingState = 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'saving';

export type WebcamPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type WebcamShape = 'circle' | 'rectangle';

export interface RecordingConfig {
  // Video sources
  screenEnabled: boolean;
  webcamEnabled: boolean;

  // Audio sources
  microphoneEnabled: boolean;
  systemAudioEnabled: boolean;

  // PiP settings
  webcamPosition: WebcamPosition;
  webcamSize: number; // 0.1 to 0.4 (percentage of screen)
  webcamShape: WebcamShape;

  // Recording settings
  countdownSeconds: number;
}

export interface EnvironmentCapabilities {
  screenCapture: boolean;
  webcam: boolean;
  microphone: boolean;
  systemAudio: boolean;
  mediaRecorder: boolean;
}

/** Reasons why a capability might be unavailable */
export type CapabilityUnavailableReason =
  | 'api_not_supported'      // Browser doesn't support the API
  | 'permission_denied'      // User denied permission
  | 'permission_dismissed'   // User dismissed the permission prompt
  | 'no_device'              // No hardware device found
  | 'not_secure_context'     // Requires HTTPS
  | 'browser_not_supported'  // Feature not supported in this browser
  | 'policy_blocked';        // Blocked by enterprise/browser policy

/** Detailed capability info including reason for unavailability */
export interface CapabilityInfo {
  available: boolean;
  reason?: CapabilityUnavailableReason;
  message?: string;
}

/** Extended capabilities with reasons */
export interface DetailedCapabilities {
  screenCapture: CapabilityInfo;
  webcam: CapabilityInfo;
  microphone: CapabilityInfo;
  systemAudio: CapabilityInfo;
  mediaRecorder: CapabilityInfo;
}

export interface AudioLevels {
  microphone: number; // 0-1
  system: number; // 0-1
}

export interface Recording {
  id: string;
  name: string;
  duration: number;
  createdAt: number;
  size: number;
  thumbnailUrl?: string;
  hasWebcam: boolean;
  hasAudio: boolean;
}

export interface RecorderStore {
  // State
  state: RecordingState;
  config: RecordingConfig;
  capabilities: EnvironmentCapabilities;
  detailedCapabilities: DetailedCapabilities;
  recordings: Recording[];

  // Current recording data
  currentDuration: number;
  countdownValue: number;
  audioLevels: AudioLevels;

  // Streams (not persisted)
  screenStream: MediaStream | null;
  webcamStream: MediaStream | null;

  // Actions
  setConfig: (config: Partial<RecordingConfig>) => void;
  setCapabilities: (caps: EnvironmentCapabilities) => void;
  setDetailedCapabilities: (caps: DetailedCapabilities) => void;
  setState: (state: RecordingState) => void;
  setCountdown: (value: number) => void;
  setCurrentDuration: (duration: number) => void;
  setAudioLevels: (levels: AudioLevels) => void;
  setStreams: (screen: MediaStream | null, webcam: MediaStream | null) => void;
  addRecording: (recording: Recording) => void;
  removeRecording: (id: string) => void;
  loadRecordings: () => Promise<void>;
}

// Default configuration
export const defaultConfig: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: false,
  microphoneEnabled: true,
  systemAudioEnabled: false,
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'circle',
  countdownSeconds: 3,
};
