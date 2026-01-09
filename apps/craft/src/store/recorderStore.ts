import { create } from 'zustand';
import type {
  RecorderStore,
  RecordingState,
  RecordingConfig,
  EnvironmentCapabilities,
  AudioLevels,
  Recording,
} from './types';
import { defaultConfig } from './types';
import { getRecordingsMetadata, getThumbnail, createBlobUrl } from '../core/storage';

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
  recordings: [],

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
