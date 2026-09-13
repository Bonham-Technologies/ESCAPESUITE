// The three things a track header button does: raise a track, lower it, delete it.
//
// Reordering is the whole of the awkwardness here, and it is an index
// convention rather than an algorithm. The store numbers tracks from the
// bottom of the stack up — index 0 is the bottom row — and `reorderTracks`
// re-numbers by array position, first element to index 0. The timeline draws
// them the other way round, so `sortedTracks` is highest-index-first and
// "up" means *earlier* in that array. Hence the shape of both handlers: swap
// the two neighbours in visual order, then reverse the whole list on its way
// back to the store, so the row now at the top gets the highest index.
//
// Deleting refuses to empty the timeline — one track always remains — and
// asks before discarding a track that still holds clips.
import { useCallback } from 'react';
import type { Clip, Track } from '../../store/types';

/** What the header buttons need that they cannot reach on their own. */
export interface TrackHeaderActionsDeps {
  /** The tracks in display order: highest index — the top row — first. */
  sortedTracks: Track[];
  /** Every track, to refuse the deletion that would leave none. */
  tracks: Track[];
  /** Every clip, to count what a deletion would take with it. */
  clips: Clip[];
  reorderTracks: (trackIds: string[]) => void;
  removeTrack: (trackId: string) => void;
}

/** The handlers `TrackHeader` binds to its buttons. */
export interface TrackHeaderActions {
  /** Move a track one row up the visual stack. */
  moveTrackUp: (trackId: string) => void;
  /** Move a track one row down the visual stack. */
  moveTrackDown: (trackId: string) => void;
  /** Delete a track, after confirming if it still holds clips. */
  handleDeleteTrack: (trackId: string) => void;
}

export function useTrackHeaderActions({
  sortedTracks,
  tracks,
  clips,
  reorderTracks,
  removeTrack,
}: TrackHeaderActionsDeps): TrackHeaderActions {
  // Move track up (toward top of visual stack)
  // sortedTracks is ordered top-first (highest index at [0])
  // reorderTracks assigns index based on array position (first = index 0 = bottom)
  // So we need to reverse the array before passing to reorderTracks
  const moveTrackUp = useCallback((trackId: string) => {
    const trackIndex = sortedTracks.findIndex(t => t.id === trackId);
    if (trackIndex <= 0) return; // Already at top

    // Swap with the track above in visual order
    const newOrder = sortedTracks.map(t => t.id);
    [newOrder[trackIndex], newOrder[trackIndex - 1]] = [newOrder[trackIndex - 1], newOrder[trackIndex]];
    // Reverse so first item gets highest index (top)
    reorderTracks([...newOrder].reverse());
  }, [sortedTracks, reorderTracks]);

  // Move track down (toward bottom of visual stack)
  const moveTrackDown = useCallback((trackId: string) => {
    const trackIndex = sortedTracks.findIndex(t => t.id === trackId);
    if (trackIndex >= sortedTracks.length - 1) return; // Already at bottom

    // Swap with the track below in visual order
    const newOrder = sortedTracks.map(t => t.id);
    [newOrder[trackIndex], newOrder[trackIndex + 1]] = [newOrder[trackIndex + 1], newOrder[trackIndex]];
    // Reverse so first item gets highest index (top)
    reorderTracks([...newOrder].reverse());
  }, [sortedTracks, reorderTracks]);

  // Delete track (with confirmation if it has clips)
  const handleDeleteTrack = useCallback((trackId: string) => {
    if (tracks.length <= 1) return; // Keep at least one track

    const trackClips = clips.filter(c => c.trackId === trackId);
    if (trackClips.length > 0) {
      if (!confirm(`Delete track with ${trackClips.length} clip(s)? This cannot be undone.`)) {
        return;
      }
    }
    removeTrack(trackId);
  }, [tracks.length, clips, removeTrack]);

  return { moveTrackUp, moveTrackDown, handleDeleteTrack };
}
