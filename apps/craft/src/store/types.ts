// Types shared with ESCAPEARTIST - imported from shared package
export type {
  MediaType,
  MediaSource,
  SourceVideo,
  RecordingRole,
  OverlayPlacement,
} from '@escapesuite/shared/types'

import type { RecordingRole } from '@escapesuite/shared/types'

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

  /**
   * Record the webcam as its own file instead of compositing it into the
   * screen (ESCSUITE-14). Off by default; only ever true for a screen+webcam
   * take in a browser with WebCodecs and room for two tracks.
   */
  separateTracks: boolean;
}

/**
 * Which half of a take a companion file is. The primary is not one of these —
 * it is the take.
 */
export type CompanionRole = 'webcam' | 'mic' | 'system';

/**
 * One of the extra blobs a separate-tracks take produces, handed to the save
 * path by the recorder's `onStop`.
 *
 * `startOffset` is 0 for every part in this build: one clock, one `start()`,
 * every pipeline's first unit stamped from the same origin. It is carried
 * rather than assumed because it is a fact about a take worth writing down —
 * and because a future pipeline that genuinely starts late (a source attached
 * mid-take) would have nowhere else to say so.
 */
export interface CompanionPart {
  role: CompanionRole;
  blob: Blob;
  startOffset: number;
}

/**
 * What a recorder calls when a take is finished.
 *
 * The second argument is the take's companions, in role order — webcam, then
 * mic, then system — or `null` when there are none. `null` rather than an
 * empty array because that is what "this take is one file" has always meant on
 * this callback, and because the recorder cannot tell "never asked for one"
 * from "asked and lost them all": only the controller, which resolved the mode
 * before the countdown, knows how many the take asked for.
 *
 * Both recorders declare this signature even though only `WebCodecsRecorder`
 * ever passes companions: one type means the controller's single `onStop` is
 * assignable to either recorder's callbacks, with no union narrowing at the
 * call site. `Recorder` (MediaRecorder) calls it with the blob alone.
 */
export type RecorderStopCallback = (
  blob: Blob,
  companions?: CompanionPart[] | null
) => void;

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

/**
 * What the browser said when asked whether it can encode an MP4 — the gate on
 * the library row's MP4 button.
 *
 * `state` is here because the answer is asynchronous: `probeMP4Support()` asks
 * WebCodecs about the real H.264 and AAC configurations, so there is a moment
 * on the way in where the answer is not known. The button is disabled for that
 * moment rather than enabled and then taken away.
 */
export interface Mp4Support {
  /** 'checking' until the codec probe has answered. */
  state: 'checking' | 'ready';
  /** Whether a conversion may be offered at all — no H.264 encoder is fatal. */
  supported: boolean;
  /**
   * Whether the browser has an AAC encoder, and so whether a conversion will
   * have sound. The AAC answer alone, whatever the H.264 answer was — the M4A
   * download needs no video encoder (ESCSUITE-61).
   *
   * It means two different things to the two downloads, because they treat it
   * differently. For **MP4** it is not a refusal: `convertToMP4` drops the
   * audio and muxes a working silent file, so `false` does not disable that
   * button — it only adds a note. For **M4A** it is the whole conversion, so
   * `false` disables that button outright, carrying `audioReason` as its
   * sentence.
   */
  audio: boolean;
  /**
   * The probe's sentence for why an MP4 cannot be written. Absent whenever
   * `supported` is true — a silent MP4 is not a refusal.
   */
  reason?: string;
  /**
   * The probe's sentence for the missing AAC encoder: what a disabled M4A
   * button says, and what the silent-MP4 note says. Absent whenever `audio` is
   * true, and the same sentence as `reason` where the probe could not run at
   * all. Kept apart from `reason` so neither gate can be titled with the other
   * one's wording.
   */
  audioReason?: string;
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
  /** The take this row belongs to; absent on a single-file take. */
  takeId?: string;
  /** Which half of the take this row is; absent on a single-file take. */
  role?: RecordingRole;
}

export interface RecorderStore {
  // State
  state: RecordingState;
  config: RecordingConfig;
  capabilities: EnvironmentCapabilities;
  detailedCapabilities: DetailedCapabilities;
  /** False until capability detection has answered — the Record button waits on it. */
  capabilitiesReady: boolean;
  /**
   * Whether this browser can actually encode an MP4, as `probeMP4Support()`
   * found. Starts out 'checking'; the library row's MP4 button is disabled
   * until it is 'ready'. Only `RecordingsListPanel` selects it.
   */
  mp4Support: Mp4Support;
  recordings: Recording[];
  /**
   * The one thing the app has to say that is not a state change — a failed
   * save, an unreadable library, a source that did not arrive. Rendered in the
   * header's live region and cleared when the next take starts. See
   * `utils/notices.ts`; there is deliberately no second channel.
   */
  notice: string | null;
  /**
   * Whether the take actually got a system-audio track. Enabling "System
   * Audio" only *asks* for it — the browser's share dialog has its own tick
   * box — so this is false whenever the capture came back without one, and it
   * is what greys the System meter.
   */
  systemAudioShared: boolean;
  /**
   * Whether the browser says there is room for another take. Measured off the
   * click path — on mount, after each save, after each delete — so the Record
   * button can refuse *before* the click rather than awaiting an estimate
   * between the click and `getDisplayMedia`.
   */
  hasStorageSpace: boolean;
  /**
   * Whether there is room for a take at roughly double the bitrate — the
   * separate-tracks toggle's second gate. Measured beside `hasStorageSpace`,
   * off the click path, by the same `refreshStorageSpace()`.
   */
  hasSeparateTracksSpace: boolean;

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
  setCapabilitiesReady: (ready: boolean) => void;
  setMp4Support: (support: Mp4Support) => void;
  setNotice: (notice: string | null) => void;
  setSystemAudioShared: (shared: boolean) => void;
  /** Re-read the storage headroom into `hasStorageSpace`. Never rejects. */
  refreshStorageSpace: () => Promise<void>;
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
  separateTracks: false,
};
