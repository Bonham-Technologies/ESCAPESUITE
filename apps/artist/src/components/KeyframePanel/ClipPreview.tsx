import { useRef, useCallback, useState, useEffect } from 'react';
import type { Clip } from '../../store/types';
import styles from './ClipPreview.module.css';

interface ClipPreviewProps {
  clip: Clip;
  playheadTime: number; // Time relative to clip start
  onTimeChange: (time: number) => void;
}

/**
 * ClipPreview - Simple playback controls for the keyframe editor
 *
 * Note: The actual preview rendering happens in the main PreviewPlayer.
 * When the keyframe panel is open, manipulating overlays in the main
 * preview creates keyframes instead of directly updating the overlay.
 */
export function ClipPreview({ clip, playheadTime, onTimeChange }: ClipPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  // Handle playback
  useEffect(() => {
    if (!isPlaying) return;

    let lastTime = performance.now();
    let currentPlayTime = playheadTime;

    const animate = () => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      currentPlayTime += delta;
      if (currentPlayTime >= clip.duration) {
        currentPlayTime = 0;
      }

      onTimeChange(currentPlayTime);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, clip.duration, onTimeChange, playheadTime]);

  // Scrubber ref for drag calculations
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Calculate time from mouse position
  const getTimeFromMouseEvent = useCallback((e: globalThis.MouseEvent | React.MouseEvent) => {
    const scrubber = scrubberRef.current;
    if (!scrubber) return playheadTime;

    const rect = scrubber.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * clip.duration;
    return Math.max(0, Math.min(time, clip.duration));
  }, [clip.duration, playheadTime]);

  // Handle scrubber mouse down (start drag)
  const handleScrubberMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    const time = getTimeFromMouseEvent(e);
    onTimeChange(time);
  }, [getTimeFromMouseEvent, onTimeChange]);

  // Handle global mouse move during drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const time = getTimeFromMouseEvent(e);
      onTimeChange(time);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, getTimeFromMouseEvent, onTimeChange]);

  // Toggle play/pause
  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.infoArea}>
        <div className={styles.clipInfo}>
          <span className={styles.clipName}>{clip.name}</span>
          <span className={styles.hint}>
            Use the main preview to manipulate overlays while keyframe panel is open
          </span>
        </div>
      </div>

      <div className={styles.controls}>
        <button className={styles.playButton} onClick={togglePlayback}>
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        <div
          ref={scrubberRef}
          className={`${styles.scrubber} ${isDragging ? styles.scrubberDragging : ''}`}
          onMouseDown={handleScrubberMouseDown}
        >
          <div
            className={styles.scrubberFill}
            style={{ width: `${(playheadTime / clip.duration) * 100}%` }}
          />
          <div
            className={styles.scrubberHandle}
            style={{ left: `${(playheadTime / clip.duration) * 100}%` }}
          />
        </div>

        <span className={styles.time}>
          {playheadTime.toFixed(2)}s / {clip.duration.toFixed(2)}s
        </span>
      </div>
    </div>
  );
}
