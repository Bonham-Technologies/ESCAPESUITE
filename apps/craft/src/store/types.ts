// Types shared with ESCAPEARTIST for integration compatibility

export type MediaType = 'video' | 'image' | 'audio';
export type MediaSource = 'upload' | 'recording';

// Compatible with ESCAPEARTIST SourceVideo type
export interface SourceVideo {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  mimeType: string;
  size: number;
  thumbnailUrl?: string;
  mediaType?: MediaType;
  // New fields for recording integration
  source?: MediaSource;
  recordedAt?: number;
}

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
