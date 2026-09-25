import { create } from 'zustand';
import type {
  RecorderStore,
  RecordingState,
  RecordingConfig,
  EnvironmentCapabilities,
  DetailedCapabilities,
  Mp4Support,
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
import { orderTakes } from '../utils/takeOrder';

/**
 * What one take is assumed to cost, for the storage headroom check.
 *
 * There is no way to know before the fact, and `hasSpaceForRecording` applies
 * its own buffer and its own relative floor on top, so this is a working
 * figure rather than an estimate.
 */
const ESTIMATED_RECORDING_BYTES = 50 * 1024 * 1024;

/**
 * What a separate-tracks take is assumed to cost, as a multiple of a plain one.
 *
 * Two `VideoEncoder`s each carry their own bitrate — the webcam is fewer pixels
 * but VP9 is configured per encoder, not per take — so double is the honest
 * working figure. `hasSpaceForRecording` applies its own buffer and relative
 * floor on top of whatever this asks for.
 */
const SEPARATE_TRACKS_SIZE_FACTOR = 2;

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
  // Nothing is claimed about MP4 until the codec probe has answered.
  mp4Support: { state: 'checking', supported: false, audio: false },
  recordings: [],
  notice: null,
  systemAudioShared: true,
  hasStorageSpace: true,
  hasSeparateTracksSpace: true,

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

  setMp4Support: (mp4Support: Mp4Support) =>
    set({ mp4Support }),

  setNotice: (notice: string | null) =>
    set({ notice }),

  setSystemAudioShared: (systemAudioShared: boolean) =>
    set({ systemAudioShared }),

  refreshStorageSpace: async () => {
    try {
      // Both answers from one call each, off the click path: the record button
      // reads the first and the separate-tracks toggle the second.
      const [hasStorageSpace, hasSeparateTracksSpace] = await Promise.all([
        hasSpaceForRecording(ESTIMATED_RECORDING_BYTES),
        hasSpaceForRecording(ESTIMATED_RECORDING_BYTES * SEPARATE_TRACKS_SIZE_FACTOR),
      ]);
      set({ hasStorageSpace, hasSeparateTracksSpace });
    } catch {
      // An estimate that threw is "unknown", and unknown is not full — the
      // same call this whole check errs toward everywhere else.
      set({ hasStorageSpace: true, hasSeparateTracksSpace: true });
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
          // Written by `buildSourceVideo` since ESCSUITE-14. Before that
          // nothing stored said whether a take had a camera in it, which is
          // what the `hasWebcam: false // TODO` here used to admit; a record
          // saved then keeps the answer it used to get.
          hasWebcam: m.hasWebcam ?? false,
          // Written by `buildSourceVideo` since ESCSUITE-60. Recordings saved
          // before that have no field at all, and keep the answer they used
          // to get — a take that did have audio would otherwise lose its M4A
          // button for good, which is worse than the stale offer.
          hasAudio: m.hasAudio ?? true,
          ...(m.takeId !== undefined ? { takeId: m.takeId } : {}),
          ...(m.role !== undefined ? { role: m.role } : {}),
        };
      })
    );

    // Newest take first, each take's companion rows directly under its primary
    // — the grouping ESCSUITE-14's save path wrote, rebuilt for the panel.
    set({ recordings: orderTakes(recordings) });
  },
}));
