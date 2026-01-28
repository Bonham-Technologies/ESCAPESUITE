import { useRef, useState, useEffect, useCallback } from 'react';
import styles from './VideoPlayer.module.css';

interface VideoPlayerProps {
  src: string;
  title?: string;
  autoPlay?: boolean;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export function VideoPlayer({ src, title, autoPlay = true, onClose, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Format time as MM:SS or HH:MM:SS
  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle video metadata loaded
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      setIsLoaded(true);
      setHasError(false);
    }
  }, []);

  // Handle time update during playback
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && !isSeeking) {
      setCurrentTime(video.currentTime);
    }
  }, [isSeeking]);

  // Handle video ended - reset to beginning
  const handleEnded = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      setCurrentTime(0);
      setIsPlaying(false);
    }
  }, []);

  // Handle video error
  const handleError = useCallback(() => {
    setHasError(true);
    setIsPlaying(false);
    onError?.(new Error('Failed to load video'));
  }, [onError]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError) return;

    if (video.paused) {
      video.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      video.pause();
    }
  }, [hasError]);

  // Handle play state changes
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  // Seek to position
  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !isLoaded) return;

    const clampedTime = Math.max(0, Math.min(time, duration));
    video.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }, [duration, isLoaded]);

  // Handle progress bar click/drag
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const progressBar = progressRef.current;
    if (!progressBar || !isLoaded) return;

    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    seekTo(percent * duration);
  }, [duration, isLoaded, seekTo]);

  // Handle progress bar drag
  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsSeeking(true);
    handleProgressClick(e);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const progressBar = progressRef.current;
      if (!progressBar) return;

      const rect = progressBar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
      seekTo(percent * duration);
    };

    const handleMouseUp = () => {
      setIsSeeking(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [duration, handleProgressClick, seekTo]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  // Handle volume change
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newVolume = parseFloat(e.target.value);
    video.volume = newVolume;
    setVolume(newVolume);
    if (newVolume === 0) {
      setIsMuted(true);
      video.muted = true;
    } else if (isMuted) {
      setIsMuted(false);
      video.muted = false;
    }
  }, [isMuted]);

  // Restart video from beginning
  const restart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    setCurrentTime(0);
    video.play().catch(() => {
      setIsPlaying(false);
    });
  }, []);

  // Skip forward/backward
  const skip = useCallback((seconds: number) => {
    seekTo(currentTime + seconds);
  }, [currentTime, seekTo]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (videoRef.current) {
            const newVol = Math.min(1, volume + 0.1);
            videoRef.current.volume = newVol;
            setVolume(newVol);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (videoRef.current) {
            const newVol = Math.max(0, volume - 0.1);
            videoRef.current.volume = newVol;
            setVolume(newVol);
          }
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case '0':
        case 'Home':
          e.preventDefault();
          seekTo(0);
          break;
        case 'End':
          e.preventDefault();
          seekTo(duration);
          break;
        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, skip, toggleMute, seekTo, duration, volume, onClose]);

  // Calculate progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.playerContainer}>
      {/* Video element */}
      <div className={styles.videoWrapper} onClick={togglePlayPause}>
        <video
          ref={videoRef}
          key={src}
          className={styles.video}
          src={src}
          autoPlay={autoPlay}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onError={handleError}
          onPlay={handlePlay}
          onPause={handlePause}
        />

        {/* Play overlay when paused */}
        {isLoaded && !isPlaying && !hasError && (
          <div className={styles.playOverlay}>
            <PlayIcon />
          </div>
        )}

        {/* Error overlay */}
        {hasError && (
          <div className={styles.errorOverlay}>
            <span className={styles.errorIcon}>!</span>
            <p>Failed to load video</p>
            <p className={styles.errorHint}>The video may be corrupted or in an unsupported format.</p>
          </div>
        )}

        {/* Loading overlay */}
        {!isLoaded && !hasError && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        {/* Progress bar */}
        <div
          ref={progressRef}
          className={styles.progressContainer}
          onClick={handleProgressClick}
          onMouseDown={handleProgressMouseDown}
        >
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFilled}
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className={styles.progressHandle}
              style={{ left: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Control buttons */}
        <div className={styles.controlsRow}>
          <div className={styles.controlsLeft}>
            {/* Play/Pause */}
            <button
              className={styles.controlButton}
              onClick={togglePlayPause}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              disabled={hasError}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>

            {/* Restart */}
            <button
              className={styles.controlButton}
              onClick={restart}
              title="Restart"
              disabled={hasError}
            >
              <RestartIcon />
            </button>

            {/* Skip backward */}
            <button
              className={styles.controlButton}
              onClick={() => skip(-5)}
              title="Back 5s (←)"
              disabled={hasError}
            >
              <SkipBackIcon />
            </button>

            {/* Skip forward */}
            <button
              className={styles.controlButton}
              onClick={() => skip(5)}
              title="Forward 5s (→)"
              disabled={hasError}
            >
              <SkipForwardIcon />
            </button>

            {/* Volume controls */}
            <div
              className={styles.volumeContainer}
              onMouseEnter={() => setShowVolumeSlider(true)}
              onMouseLeave={() => setShowVolumeSlider(false)}
            >
              <button
                className={styles.controlButton}
                onClick={toggleMute}
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {isMuted || volume === 0 ? <VolumeMuteIcon /> : volume < 0.5 ? <VolumeLowIcon /> : <VolumeHighIcon />}
              </button>
              {showVolumeSlider && (
                <div className={styles.volumeSliderContainer}>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className={styles.volumeSlider}
                  />
                </div>
              )}
            </div>

            {/* Time display */}
            <span className={styles.timeDisplay}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className={styles.controlsRight}>
            {title && <span className={styles.title}>{title}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Icons
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <path d="M1 4v6h6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
    </svg>
  );
}

function VolumeHighIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" strokeLinecap="round" />
    </svg>
  );
}

function VolumeLowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" strokeLinecap="round" />
    </svg>
  );
}

function VolumeMuteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <line x1="23" y1="9" x2="17" y2="15" strokeLinecap="round" />
      <line x1="17" y1="9" x2="23" y2="15" strokeLinecap="round" />
    </svg>
  );
}

export default VideoPlayer;
