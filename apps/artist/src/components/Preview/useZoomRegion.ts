// Zoom to region's one piece of state (ESCSUITE-475): the box the user asked
// for, fitted on every render to where the clip's picture is at the playhead,
// so the picker and the form always show the box Apply would write.
import { useState } from 'react';
import { defaultZoomRegion, fitZoomRegion, zoomBounds, type ZoomRect } from '../../utils/zoomToRegion';
import type { ZoomRegionTarget } from './zoomRegionTarget';
import type { ProjectSize } from './types';

export interface ZoomRegionState {
  /** The box as fitted, in project pixels, or null when the clip offers none. */
  region: ZoomRect | null;
  /** Ask for a box; it is fitted before anything shows it. */
  request: (rect: ZoomRect) => void;
}

/**
 * The tool's one piece of state: the box asked for, per clip. Null before the
 * user asks for one, which shows {@link defaultZoomRegion}.
 */
export function useZoomRegion(
  target: ZoomRegionTarget | null,
  project: ProjectSize,
  currentTime: number
): ZoomRegionState {
  const [asked, setAsked] = useState<{ clipId: string; rect: ZoomRect } | null>(null);
  const clipId = target?.clip.id;
  const request = (rect: ZoomRect) => {
    if (clipId) setAsked({ clipId, rect });
  };
  if (!target) return { region: null, request };

  const { clip, source } = target;
  const clipTime = Math.min(clip.duration, Math.max(0, currentTime - clip.timelinePosition));
  const bounds = zoomBounds(clip, source, project, clipTime);
  if (!bounds) return { region: null, request };
  const rect = asked?.clipId === clip.id ? asked.rect : defaultZoomRegion(bounds, project);
  return { region: rect && fitZoomRegion(rect, bounds, project), request };
}
