/**
 * Export Worker - Offloads computation from main thread during export
 *
 * Handles:
 * - Audio extraction and mixing (OfflineAudioContext)
 * - Frame metadata computation (clip visibility, transforms, transitions)
 *
 * Main thread still handles (requires DOM):
 * - Video element seeking
 * - Canvas rendering
 * - VideoEncoder/AudioEncoder
 * - Muxing
 */

import type {
  Clip,
  Track,
  ClipTransform,
  ClipEffects,
  ClipAnimation,
  TransitionType,
  BlendMode,
} from '../store/types';

// Message types from main thread to worker
export type WorkerRequest =
  | { type: 'INIT'; clips: Clip[]; tracks: Track[]; totalDuration: number }
  | { type: 'COMPUTE_FRAME'; frameTime: number }
  | { type: 'EXTRACT_AUDIO'; audioBlobs: ArrayBuffer[]; clipMeta: AudioClipMeta[] }
  | { type: 'TERMINATE' };

// Audio clip metadata for mixing
export interface AudioClipMeta {
  sourceIndex: number; // Index into audioBlobs array
  clipId: string;
  trackId: string;
  trackVolume: number;
  trackMuted: boolean;
  sourceStartTime: number;
  clipDuration: number;
  timelinePosition: number;
}

// Message types from worker to main thread
export type WorkerResponse =
  | { type: 'INIT_COMPLETE' }
  | { type: 'FRAME_METADATA'; data: FrameRenderData }
  | { type: 'AUDIO_READY'; audioBuffer: Float32Array; hasAudio: boolean }
  | { type: 'AUDIO_PROGRESS'; progress: number }
  | { type: 'ERROR'; error: string };

// Computed values for rendering a single clip
export interface ClipRenderState {
  clipId: string;
  sourceVideoId: string;
  trackId: string;
  sourceTime: number; // Time to seek in source video
  clipTime: number; // Time relative to clip start (for animations)
  blendMode: BlendMode;
  transform: ClipTransform;
  opacity: number;
  blur: number;
  isOverlay: boolean;
  overlayType?: 'text' | 'shape';
  textData?: unknown;
  shapeData?: unknown;
}

// Transition render state
export interface TransitionRenderState {
  type: TransitionType;
  progress: number;
  outgoingClipId: string;
  incomingClipId: string;
}

// Complete frame render data
export interface FrameRenderData {
  frameTime: number;
  clips: ClipRenderState[];
  transition: TransitionRenderState | null;
}

// Worker state
let clips: Clip[] = [];
let tracks: Track[] = [];
let totalDuration = 0;

// Default values
const DEFAULT_TRANSFORM: ClipTransform = {
  x: 0.5,
  y: 0.5,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

const DEFAULT_EFFECTS: ClipEffects = {
  blur: 0,
};

// Easing functions
type EasingFn = (t: number) => number;

const easingFunctions: Record<string, EasingFn> = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  'ease-in-quad': (t) => t * t,
  'ease-out-quad': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out-quad': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out-cubic': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

function getEasing(type: string): EasingFn {
  return easingFunctions[type] || easingFunctions.linear;
}

/**
 * Interpolate keyframes for a property
 */
function interpolateKeyframes(
  keyframes: Array<{ time: number; value: number; easing: string }>,
  time: number
): number | null {
  if (!keyframes || keyframes.length === 0) return null;

  // Sort by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // Before first keyframe
  if (time <= sorted[0].time) return sorted[0].value;

  // After last keyframe
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  // Find surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      const t = (time - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
      const easing = getEasing(sorted[i].easing);
      return sorted[i].value + (sorted[i + 1].value - sorted[i].value) * easing(t);
    }
  }

  return sorted[sorted.length - 1].value;
}

/**
 * Get animation preset values
 */
function getPresetValues(
  presetType: string,
  progress: number,
  isOut: boolean
): Partial<ClipTransform & { blur: number }> {
  const t = isOut ? 1 - progress : progress;
  const eased = t; // Use linear for now, actual easing applied separately

  switch (presetType) {
    case 'fade':
      return { opacity: eased };
    case 'slide-left':
      return { x: isOut ? 0.5 - (1 - eased) * 0.5 : eased * 0.5 };
    case 'slide-right':
      return { x: isOut ? 0.5 + (1 - eased) * 0.5 : 1 - eased * 0.5 };
    case 'slide-up':
      return { y: isOut ? 0.5 - (1 - eased) * 0.5 : eased * 0.5 };
    case 'slide-down':
      return { y: isOut ? 0.5 + (1 - eased) * 0.5 : 1 - eased * 0.5 };
    case 'scale':
    case 'scale-up':
      return { scaleX: eased, scaleY: eased };
    case 'scale-down':
      return { scaleX: 2 - eased, scaleY: 2 - eased };
    case 'pop':
      // Overshoot effect
      const overshoot = eased > 0.7 ? 1 + (eased - 0.7) * 0.3 : eased * 1.1;
      return { scaleX: Math.min(1, overshoot), scaleY: Math.min(1, overshoot) };
    case 'blur':
      return { blur: (1 - eased) * 10 };
    default:
      return {};
  }
}

/**
 * Compute animated values for a clip at a given time
 */
function computeAnimatedValues(
  clipTime: number,
  clipDuration: number,
  animation: ClipAnimation | undefined,
  transform: ClipTransform,
  effects: ClipEffects
): { transform: ClipTransform; opacity: number; blur: number } {
  let result = { ...transform };
  let blur = effects.blur;

  if (!animation) {
    return { transform: result, opacity: result.opacity, blur };
  }

  // Apply in animation
  if (animation.in.type !== 'none' && clipTime < animation.in.duration) {
    const progress = clipTime / animation.in.duration;
    const presetValues = getPresetValues(animation.in.type, progress, false);
    result = { ...result, ...presetValues };
    if (presetValues.blur !== undefined) blur = presetValues.blur;
  }

  // Apply out animation
  const outStart = clipDuration - animation.out.duration;
  if (animation.out.type !== 'none' && clipTime > outStart) {
    const progress = (clipTime - outStart) / animation.out.duration;
    const presetValues = getPresetValues(animation.out.type, progress, true);
    result = { ...result, ...presetValues };
    if (presetValues.blur !== undefined) blur = presetValues.blur;
  }

  // Apply keyframes (override presets)
  if (animation.keyframes) {
    for (const prop of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const) {
      const keyframes = animation.keyframes[prop];
      if (keyframes && keyframes.length > 0) {
        const value = interpolateKeyframes(keyframes, clipTime);
        if (value !== null) {
          (result as unknown as Record<string, number>)[prop] = value;
        }
      }
    }
    // Handle blur keyframes
    const blurKeyframes = animation.keyframes.blur;
    if (blurKeyframes && blurKeyframes.length > 0) {
      const value = interpolateKeyframes(blurKeyframes, clipTime);
      if (value !== null) blur = value;
    }
  }

  return { transform: result, opacity: result.opacity, blur };
}

/**
 * Get clips visible at a given time
 */
function getClipsAtTime(time: number): Array<{ clip: Clip; track: Track | undefined; clipTime: number }> {
  const result: Array<{ clip: Clip; track: Track | undefined; clipTime: number }> = [];

  for (const clip of clips) {
    const clipEnd = clip.timelinePosition + clip.duration;
    if (time >= clip.timelinePosition && time < clipEnd) {
      const track = tracks.find((t) => t.id === clip.trackId);
      if (!track || !track.visible) continue;

      result.push({
        clip,
        track,
        clipTime: time - clip.timelinePosition,
      });
    }
  }

  // Sort by track index (lower = bottom = rendered first)
  return result.sort((a, b) => (a.track?.index ?? 0) - (b.track?.index ?? 0));
}

/**
 * Check for active transition at a given time
 */
function getActiveTransition(time: number): TransitionRenderState | null {
  for (const clip of clips) {
    if (clip.transition.type === 'none' || clip.transition.duration <= 0) continue;

    const track = tracks.find((t) => t.id === clip.trackId);
    if (!track || !track.visible) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    const transitionStart = clipEnd - clip.transition.duration;

    if (time >= transitionStart && time < clipEnd) {
      // Find incoming clip
      let incomingClip = clips
        .filter((c) => c.trackId === clip.trackId && c.timelinePosition >= clipEnd - 0.01 && c.id !== clip.id)
        .sort((a, b) => a.timelinePosition - b.timelinePosition)[0];

      if (!incomingClip) {
        const clipsAtEnd = clips
          .filter((c) => {
            if (c.id === clip.id) return false;
            if (c.overlayType) return false;
            const cEnd = c.timelinePosition + c.duration;
            return c.timelinePosition <= clipEnd && cEnd > clipEnd;
          })
          .map((c) => {
            const t = tracks.find((tr) => tr.id === c.trackId);
            return { clip: c, track: t };
          })
          .filter(({ track: t }) => t && t.visible)
          .sort((a, b) => (b.track?.index ?? 0) - (a.track?.index ?? 0));

        if (clipsAtEnd.length > 0) {
          incomingClip = clipsAtEnd[0].clip;
        }
      }

      if (incomingClip) {
        const progress = (time - transitionStart) / clip.transition.duration;
        return {
          type: clip.transition.type,
          progress: Math.min(1, Math.max(0, progress)),
          outgoingClipId: clip.id,
          incomingClipId: incomingClip.id,
        };
      }
    }
  }
  return null;
}

/**
 * Compute frame render data
 */
function computeFrameMetadata(frameTime: number): FrameRenderData {
  const activeClips = getClipsAtTime(frameTime);
  const transition = getActiveTransition(frameTime);

  const clipStates: ClipRenderState[] = [];

  for (const { clip, clipTime } of activeClips) {
    const baseTransform = clip.transform || DEFAULT_TRANSFORM;
    const effects = clip.effects || DEFAULT_EFFECTS;

    const { transform, opacity, blur } = computeAnimatedValues(
      clipTime,
      clip.duration,
      clip.animation,
      baseTransform,
      effects
    );

    clipStates.push({
      clipId: clip.id,
      sourceVideoId: clip.sourceVideoId,
      trackId: clip.trackId,
      sourceTime: clip.startTime + clipTime,
      clipTime,
      blendMode: clip.blendMode,
      transform,
      opacity,
      blur,
      isOverlay: !!clip.overlayType,
      overlayType: clip.overlayType,
      textData: clip.textData,
      shapeData: clip.shapeData,
    });
  }

  return {
    frameTime,
    clips: clipStates,
    transition,
  };
}

/**
 * Extract and mix audio from multiple sources
 */
async function extractAndMixAudio(
  audioBlobs: ArrayBuffer[],
  clipMeta: AudioClipMeta[]
): Promise<{ buffer: Float32Array; hasAudio: boolean }> {
  const sampleRate = 48000;
  const channels = 2;
  const totalSamples = Math.ceil(totalDuration * sampleRate);

  // Create output buffer (stereo interleaved)
  const outputBuffer = new Float32Array(totalSamples * channels);

  let hasAnyAudio = false;
  let processedClips = 0;

  for (const meta of clipMeta) {
    if (meta.trackMuted) {
      processedClips++;
      continue;
    }

    const blob = audioBlobs[meta.sourceIndex];
    if (!blob) {
      processedClips++;
      continue;
    }

    try {
      // Create offline context for decoding
      const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);

      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await offlineCtx.decodeAudioData(blob.slice(0));
      } catch {
        processedClips++;
        continue;
      }

      hasAnyAudio = true;

      // Calculate positions
      const clipStartInTimeline = meta.timelinePosition;
      const clipSourceStart = meta.sourceStartTime;
      const clipDuration = meta.clipDuration;

      const outputStartSample = Math.floor(clipStartInTimeline * sampleRate);
      const sourceStartSample = Math.floor(clipSourceStart * sampleRate);
      const durationSamples = Math.floor(clipDuration * sampleRate);

      // Mix audio with track volume
      for (let ch = 0; ch < Math.min(channels, audioBuffer.numberOfChannels); ch++) {
        const sourceData = audioBuffer.getChannelData(ch);

        for (let s = 0; s < durationSamples; s++) {
          const sourceIdx = sourceStartSample + s;
          const outputIdx = (outputStartSample + s) * channels + ch;

          if (
            sourceIdx >= 0 &&
            sourceIdx < sourceData.length &&
            outputIdx >= 0 &&
            outputIdx < outputBuffer.length
          ) {
            outputBuffer[outputIdx] += sourceData[sourceIdx] * meta.trackVolume;
          }
        }
      }

      // If mono source, copy to both channels
      if (audioBuffer.numberOfChannels === 1) {
        const sourceData = audioBuffer.getChannelData(0);
        for (let s = 0; s < durationSamples; s++) {
          const sourceIdx = sourceStartSample + s;
          const outputIdx = (outputStartSample + s) * channels + 1;

          if (
            sourceIdx >= 0 &&
            sourceIdx < sourceData.length &&
            outputIdx >= 0 &&
            outputIdx < outputBuffer.length
          ) {
            outputBuffer[outputIdx] += sourceData[sourceIdx] * meta.trackVolume;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to extract audio from clip:', e);
    }

    processedClips++;

    // Report progress
    self.postMessage({
      type: 'AUDIO_PROGRESS',
      progress: (processedClips / clipMeta.length) * 100,
    } as WorkerResponse);
  }

  // Normalize to prevent clipping
  if (hasAnyAudio) {
    let maxSample = 0;
    for (let i = 0; i < outputBuffer.length; i++) {
      maxSample = Math.max(maxSample, Math.abs(outputBuffer[i]));
    }

    if (maxSample > 1) {
      const scale = 0.95 / maxSample;
      for (let i = 0; i < outputBuffer.length; i++) {
        outputBuffer[i] *= scale;
      }
    }
  }

  return { buffer: outputBuffer, hasAudio: hasAnyAudio };
}

// Handle messages from main thread
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'INIT':
        clips = msg.clips;
        tracks = msg.tracks;
        totalDuration = msg.totalDuration;
        self.postMessage({ type: 'INIT_COMPLETE' } as WorkerResponse);
        break;

      case 'COMPUTE_FRAME':
        const frameData = computeFrameMetadata(msg.frameTime);
        self.postMessage({ type: 'FRAME_METADATA', data: frameData } as WorkerResponse);
        break;

      case 'EXTRACT_AUDIO':
        const { buffer, hasAudio } = await extractAndMixAudio(msg.audioBlobs, msg.clipMeta);
        self.postMessage(
          { type: 'AUDIO_READY', audioBuffer: buffer, hasAudio } as WorkerResponse,
          { transfer: [buffer.buffer] }
        );
        break;

      case 'TERMINATE':
        self.close();
        break;
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
    } as WorkerResponse);
  }
};
