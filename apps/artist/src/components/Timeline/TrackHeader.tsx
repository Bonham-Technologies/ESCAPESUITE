import React, { useCallback, useState } from 'react';
import type { Track } from '../../store/types';
import styles from './Timeline.module.css';

interface TrackHeaderProps {
  track: Track;
  /**
   * This track's place in the visual stack, top-first — the index into the
   * caller's `sortedTracks`, not `track.index`. The top row cannot move up and
   * the bottom row cannot move down.
   */
  index: number;
  /** How many tracks the timeline has; the last track cannot be deleted. */
  trackCount: number;
  onUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
  onMoveTrackUp: (trackId: string) => void;
  onMoveTrackDown: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
}

/**
 * One row of the track-headers column: the volume slider and mute button, the
 * track's name (double-click to rename it in place), the reorder arrows, and
 * the visibility / lock / delete controls.
 *
 * Renaming is this component's own state, because it is per-track and nothing
 * outside the header ever reads it: the draft name lives here until Enter or a
 * blur commits it through `onUpdateTrack`, and Escape throws it away.
 *
 * Everything else is the caller's: reordering needs the whole stack and
 * deleting needs the clips that would go with the track, so both arrive as
 * callbacks that take a track id.
 *
 * `React.memo`'d: nothing a header shows changes during a clip drag, a marquee
 * or playback, and `Timeline` re-renders on every pointer frame of a gesture
 * because the drag and marquee state live in its hooks. All six props are
 * stable through those three — the three callbacks come from
 * `useTrackHeaderActions`, whose deps are the track list and the clips — so
 * the whole headers column sits them out (`timelineGestures.perf.test.ts`).
 * Not through a trim: a trim writes the store every move, `clips` changes,
 * and `onDeleteTrack` changes identity with it, so the column re-renders.
 */
export const TrackHeader = React.memo(function TrackHeader({
  track,
  index,
  trackCount,
  onUpdateTrack,
  onMoveTrackUp,
  onMoveTrackDown,
  onDeleteTrack,
}: TrackHeaderProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');

  // Handle mute toggle with volume memory
  const handleMuteToggle = useCallback(() => {
    if (track.muted) {
      // Unmuting: restore last volume (or default to 1 if no lastVolume)
      const restoredVolume = track.lastVolume ?? 1;
      onUpdateTrack(track.id, { muted: false, volume: restoredVolume });
    } else {
      // Muting: save current volume and set to 0
      onUpdateTrack(track.id, { muted: true, lastVolume: track.volume, volume: 0 });
    }
  }, [track, onUpdateTrack]);

  // Handle track name editing
  const handleTrackNameDoubleClick = useCallback(() => {
    setIsEditingName(true);
    setEditingName(track.name);
  }, [track.name]);

  const handleTrackNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingName(e.target.value);
  }, []);

  const handleTrackNameBlur = useCallback(() => {
    if (isEditingName && editingName.trim()) {
      onUpdateTrack(track.id, { name: editingName.trim() });
    }
    setIsEditingName(false);
    setEditingName('');
  }, [isEditingName, editingName, onUpdateTrack, track.id]);

  const handleTrackNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTrackNameBlur();
    } else if (e.key === 'Escape') {
      setIsEditingName(false);
      setEditingName('');
    }
  }, [handleTrackNameBlur]);

  return (
    <div
      className={styles.trackHeader}
      style={{ height: track.height }}
    >
      {/* Left side: Vertical volume slider */}
      <div className={styles.trackVolumeSection}>
        <input
          type="range"
          className={styles.trackVolumeSlider}
          min="0"
          max="1"
          step="0.01"
          value={track.volume ?? 1}
          onChange={(e) => {
            const newVolume = parseFloat(e.target.value);
            // If adjusting volume while muted, unmute
            if (track.muted && newVolume > 0) {
              onUpdateTrack(track.id, { volume: newVolume, muted: false });
            } else {
              onUpdateTrack(track.id, { volume: newVolume, lastVolume: newVolume > 0 ? newVolume : track.lastVolume });
            }
          }}
          title={`Volume: ${Math.round((track.volume ?? 1) * 100)}%`}
          aria-label={`${track.name} volume`}
        />
        <button
          className={`${styles.trackMuteBtn} ${track.muted ? styles.active : ''}`}
          onClick={handleMuteToggle}
          title={track.muted ? 'Unmute' : 'Mute'}
        >
          {track.muted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
      </div>

      {/* Right side: Track info and controls */}
      <div className={styles.trackInfoSection}>
        <div className={styles.trackHeaderTop}>
          {isEditingName ? (
            <input
              type="text"
              className={styles.trackNameInput}
              value={editingName}
              onChange={handleTrackNameChange}
              onBlur={handleTrackNameBlur}
              onKeyDown={handleTrackNameKeyDown}
              autoFocus
            />
          ) : (
            <span
              className={styles.trackName}
              onDoubleClick={handleTrackNameDoubleClick}
              title="Double-click to rename"
            >
              {track.name}
            </span>
          )}
          <div className={styles.trackReorderBtns}>
            <button
              className={styles.trackMoveBtn}
              onClick={() => onMoveTrackUp(track.id)}
              disabled={index === 0}
              title="Move track up"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4L4 14h16L12 4z" />
              </svg>
            </button>
            <button
              className={styles.trackMoveBtn}
              onClick={() => onMoveTrackDown(track.id)}
              disabled={index === trackCount - 1}
              title="Move track down"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 20l8-10H4l8 10z" />
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.trackControls}>
          <button
            className={`${styles.trackControlBtn} ${!track.visible ? styles.active : ''}`}
            onClick={() => onUpdateTrack(track.id, { visible: !track.visible })}
            title={track.visible ? 'Hide track' : 'Show track'}
          >
            {track.visible ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
          <button
            className={`${styles.trackControlBtn} ${track.locked ? styles.active : ''}`}
            onClick={() => onUpdateTrack(track.id, { locked: !track.locked })}
            title={track.locked ? 'Unlock track' : 'Lock track'}
          >
            {track.locked ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </button>
          <button
            className={`${styles.trackControlBtn} ${styles.trackDeleteBtn}`}
            onClick={() => onDeleteTrack(track.id)}
            disabled={trackCount <= 1}
            title="Delete track"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});
