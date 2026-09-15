import { create } from 'zustand';
import type {
  RecorderStore,
  RecordingState,
  RecordingConfig,
  EnvironmentCapabilities,
  DetailedCapabilities,
  AudioLevels,
  Recording,
} from './types';
import { defaultConfig } from './types';
import {
  getRecordingsMetadata,
  getThumbnail,
  createBlobUrl,
  hasSpaceForRecording,
} from '../core/storage';

/**
 * What one take is assumed to cost, for the storage headroom check.
 *
 * There is no way to know before the fact, and `hasSpaceForRecording` applies
 * its own buffer and its own relative floor on top, so this is a working
 * figure rather than an estimate.
 */
const ESTIMATED_RECORDING_BYTES = 50 * 1024 * 1024;

export const useRecorderStore = create<RecorderStore>((set) => ({
  // Initial state
  state: 'idle',
  config: defaultConfig,
  capabilities: {
    screenCapture: false,
    webcam: false,
    microphone: false,
    systemAudio: false,
    mediaRecorder: false,
  },
  detailedCapabilities: {
    screenCapture: { available: false, reason: 'api_not_supported', message: 'Checking...' },
    webcam: { available: false, reason: 'api_not_supported', message: 'Checking...' },
    microphone: { available: false, reason: 'api_not_supported', message: 'Checking...' },
    systemAudio: { available: false, reason: 'api_not_supported', message: 'Checking...' },
    mediaRecorder: { available: false, reason: 'api_not_supported', message: 'Checking...' },
  },
  capabilitiesReady: false,
  recordings: [],
  notice: null,
  systemAudioShared: true,
  hasStorageSpace: true,

  // Current recording data
  currentDuration: 0,
  countdownValue: 0,
  audioLevels: { microphone: 0, system: 0 },

  // Streams
  screenStream: null,
  webcamStream: null,

  // Actions
  setConfig: (config: Partial<RecordingConfig>) =>
    set((state) => ({
      config: { ...state.config, ...config },
    })),

  setCapabilities: (capabilities: EnvironmentCapabilities) =>
    set({ capabilities }),

  setDetailedCapabilities: (detailedCapabilities: DetailedCapabilities) =>
    set({ detailedCapabilities }),

  setCapabilitiesReady: (capabilitiesReady: boolean) =>
    set({ capabilitiesReady }),

  setNotice: (notice: string | null) =>
    set({ notice }),

  setSystemAudioShared: (systemAudioShared: boolean) =>
    set({ systemAudioShared }),

  refreshStorageSpace: async () => {
    try {
      set({ hasStorageSpace: await hasSpaceForRecording(ESTIMATED_RECORDING_BYTES) });
    } catch {
      // An estimate that threw is "unknown", and unknown is not full — the
      // same call this whole check errs toward everywhere else.
      set({ hasStorageSpace: true });
    }
  },

  setState: (newState: RecordingState) =>
    set({ state: newState }),

  setCountdown: (countdownValue: number) =>
    set({ countdownValue }),

  setCurrentDuration: (currentDuration: number) =>
    set({ currentDuration }),

  setAudioLevels: (audioLevels: AudioLevels) =>
    set({ audioLevels }),

  setStreams: (screenStream: MediaStream | null, webcamStream: MediaStream | null) =>
    set({ screenStream, webcamStream }),

  addRecording: (recording: Recording) =>
    set((state) => ({
      recordings: [recording, ...state.recordings],
    })),

  removeRecording: (id: string) =>
    set((state) => ({
      recordings: state.recordings.filter((r) => r.id !== id),
    })),

  loadRecordings: async () => {
    const metadata = await getRecordingsMetadata();

    const recordings: Recording[] = await Promise.all(
      metadata.map(async (m) => {
        let thumbnailUrl: string | undefined;
        const thumbnailBlob = await getThumbnail(m.id);
        if (thumbnailBlob) {
          thumbnailUrl = createBlobUrl(thumbnailBlob);
        }

        return {
          id: m.id,
          name: m.name,
          duration: m.duration,
          createdAt: m.recordedAt || 0,
          size: m.size,
          thumbnailUrl,
          hasWebcam: false, // TODO: Store this in metadata
          hasAudio: true, // TODO: Store this in metadata
        };
      })
    );

    // Sort by creation date, newest first
    recordings.sort((a, b) => b.createdAt - a.createdAt);

    set({ recordings });
  },
}));
