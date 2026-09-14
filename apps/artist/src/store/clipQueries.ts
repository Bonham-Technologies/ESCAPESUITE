// Read-only queries over a timeline's clips. They take the clips and tracks as
// arguments and never touch the store, so they are safe to call from a worker.

import type { Clip, Track } from './types';

// Get all clips at a specific timeline time, sorted by track index (for compositing)
export function getClipsAtTime(
  clips: Clip[],
  tracks: Track[],
  time: number
): { clip: Clip; clipTime: number; track: Track }[] {
  const results: { clip: Clip; clipTime: number; track: Track }[] = [];
  const trackMap = new Map(tracks.map(t => [t.id, t]));

  for (const clip of clips) {
    const clipEnd = clip.timelinePosition + clip.duration;
    if (time >= clip.timelinePosition && time < clipEnd) {
      const track = trackMap.get(clip.trackId);
      if (track && track.visible) {
        results.push({
          clip,
          clipTime: time - clip.timelinePosition,
          track,
        });
      }
    }
  }

  // Sort by track index (lower index = rendered first/bottom)
  results.sort((a, b) => a.track.index - b.track.index);
  return results;
}

// Legacy helper - get single clip at time (for backwards compatibility)
export function getClipAtTime(clips: Clip[], time: number): { clip: Clip; clipTime: number } | null {
  for (const clip of clips) {
    const clipEnd = clip.timelinePosition + clip.duration;
    if (time >= clip.timelinePosition && time < clipEnd) {
      return {
        clip,
        clipTime: time - clip.timelinePosition,
      };
    }
  }
  return null;
}

// Get timeline position for a clip (now just returns timelinePosition)
export function getClipPosition(clips: Clip[], clipId: string): number {
  const clip = clips.find(c => c.id === clipId);
  return clip?.timelinePosition ?? -1;
}
