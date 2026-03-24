// Core recording engine using MediaRecorder API

import fixWebmDuration from 'webm-duration-fix';
import { getSupportedMimeType, stopStream } from './permissions';
import type { RecordingConfig, AudioLevels } from '../store/types';

export interface RecorderCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: (blob: Blob) => void;
  onError?: (error: Error) => void;
  onAudioLevels?: (levels: AudioLevels) => void;
}

export class Recorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private combinedStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private systemAnalyser: AnalyserNode | null = null;
  private animationFrameId: number | null = null;
  private callbacks: RecorderCallbacks = {};
  private startTime: number = 0;
  private pausedDuration: number = 0;
  private pauseStartTime: number = 0;
  private trackEndedHandlers: Map<MediaStreamTrack, () => void> = new Map();

  constructor(callbacks: RecorderCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Initialize the recorder with the given streams.
   */
  async initialize(
    screenStream: MediaStream | null,
    webcamStream: MediaStream | null,
    micStream: MediaStream | null,
    config: RecordingConfig
  ): Promise<void> {
    const tracks: MediaStreamTrack[] = [];

    // Add video track (screen or webcam)
    if (screenStream && config.screenEnabled) {
      const videoTrack = screenStream.getVideoTracks()[0];
      if (videoTrack) {
        tracks.push(videoTrack);
      }
    } else if (webcamStream && config.webcamEnabled) {
      const videoTrack = webcamStream.getVideoTracks()[0];
      if (videoTrack) {
        tracks.push(videoTrack);
      }
    }

    // Set up audio context for mixing and level monitoring
    this.audioContext = new AudioContext();
    // Resume audio context (required in Chrome due to autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    const destination = this.audioContext.createMediaStreamDestination();

    // Add system audio if available
    if (screenStream && config.systemAudioEnabled) {
      const systemAudioTrack = screenStream.getAudioTracks()[0];
      if (systemAudioTrack) {
        const systemSource = this.audioContext.createMediaStreamSource(
          new MediaStream([systemAudioTrack])
        );
        systemSource.connect(destination);

        // Set up analyser for system audio
        this.systemAnalyser = this.audioContext.createAnalyser();
        this.systemAnalyser.fftSize = 256;
        systemSource.connect(this.systemAnalyser);
      }
    }

    // Add microphone audio if available
    if (micStream && config.microphoneEnabled) {
      const micSource = this.audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

      // Set up analyser for microphone
      this.micAnalyser = this.audioContext.createAnalyser();
      this.micAnalyser.fftSize = 256;
      micSource.connect(this.micAnalyser);
    }

    // Add mixed audio track if we have any audio
    if (destination.stream.getAudioTracks().length > 0) {
      tracks.push(destination.stream.getAudioTracks()[0]);
    }

    if (tracks.length === 0) {
      throw new Error('No tracks available for recording');
    }

    this.combinedStream = new MediaStream(tracks);

    // Listen for track ended events (e.g., user stops screen share)
    // This helps handle cases where the capture source is stopped externally
    for (const track of tracks) {
      const handler = () => {
        console.warn(`Track ended: ${track.kind} - ${track.label}`);
        // If a video track ends while recording, stop the recording gracefully
        if (track.kind === 'video' && this.mediaRecorder?.state === 'recording') {
          console.warn('Video track ended during recording, stopping...');
          this.stop();
        }
      };
      track.addEventListener('ended', handler);
      this.trackEndedHandlers.set(track, handler);
    }

    // Create MediaRecorder
    const mimeType = getSupportedMimeType();
    this.mediaRecorder = new MediaRecorder(this.combinedStream, {
      mimeType,
      videoBitsPerSecond: 2500000, // 2.5 Mbps — good quality for screen capture, less CPU pressure
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const rawBlob = new Blob(this.chunks, { type: mimeType });

      // Fire onStop immediately with the raw blob — don't block on metadata fix.
      // The webm-duration-fix is expensive (parses entire blob) and should happen
      // in the save pipeline, not in the stop handler.
      this.callbacks.onStop?.(rawBlob);
      this.cleanup();
    };

    this.mediaRecorder.onerror = (event) => {
      this.callbacks.onError?.(new Error(`Recording error: ${event}`));
      this.cleanup();
    };

    // Start audio level monitoring
    this.startAudioLevelMonitoring();
  }

  /**
   * Start recording.
   */
  start(): void {
    if (!this.mediaRecorder) {
      throw new Error('Recorder not initialized');
    }

    this.chunks = [];
    this.startTime = Date.now();
    this.pausedDuration = 0;
    this.mediaRecorder.start(1000); // Collect data every second
    this.callbacks.onStart?.();
  }

  /**
   * Pause recording.
   */
  pause(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.pauseStartTime = Date.now();
      this.mediaRecorder.pause();
      this.callbacks.onPause?.();
    }
  }

  /**
   * Resume recording.
   */
  resume(): void {
    if (this.mediaRecorder?.state === 'paused') {
      this.pausedDuration += Date.now() - this.pauseStartTime;
      this.mediaRecorder.resume();
      this.callbacks.onResume?.();
    }
  }

  /**
   * Stop recording and finalize.
   */
  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  /**
   * Get the current recording duration in seconds.
   */
  getDuration(): number {
    if (!this.startTime) return 0;

    let elapsed = Date.now() - this.startTime - this.pausedDuration;

    if (this.mediaRecorder?.state === 'paused') {
      elapsed -= Date.now() - this.pauseStartTime;
    }

    return Math.max(0, elapsed / 1000);
  }

  /**
   * Check if recording is active.
   */
  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  /**
   * Check if recording is paused.
   */
  isPaused(): boolean {
    return this.mediaRecorder?.state === 'paused';
  }

  /**
   * Start monitoring audio levels.
   */
  private startAudioLevelMonitoring(): void {
    let lastUpdate = 0;
    const updateInterval = 80; // ~12fps — plenty for a level meter, saves CPU

    const monitor = () => {
      const now = performance.now();
      if (now - lastUpdate >= updateInterval) {
        lastUpdate = now;
        const levels: AudioLevels = {
          microphone: this.getAudioLevel(this.micAnalyser),
          system: this.getAudioLevel(this.systemAnalyser),
        };
        this.callbacks.onAudioLevels?.(levels);
      }
      this.animationFrameId = requestAnimationFrame(monitor);
    };

    monitor();
  }

  /**
   * Get audio level from an analyser node (0-1).
   */
  private getAudioLevel(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Normalize to 0-1 range
    return Math.min(1, rms / 128);
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Remove track ended event listeners
    for (const [track, handler] of this.trackEndedHandlers) {
      track.removeEventListener('ended', handler);
    }
    this.trackEndedHandlers.clear();

    this.micAnalyser = null;
    this.systemAnalyser = null;
    this.combinedStream = null;
    this.mediaRecorder = null;
  }

  /**
   * Dispose of the recorder and all streams.
   */
  dispose(): void {
    this.cleanup();
    stopStream(this.combinedStream);
  }
}
