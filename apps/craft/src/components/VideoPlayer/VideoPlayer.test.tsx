import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { VideoPlayer } from './VideoPlayer';

// Mock HTMLMediaElement methods
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: mockPlay,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: mockPause,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get: () => 120, // 2 minutes
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    writable: true,
    value: 0,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    writable: true,
    value: 1,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
    configurable: true,
    writable: true,
    value: false,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('VideoPlayer', () => {
  const defaultProps = {
    src: 'blob:http://localhost/test-video',
    title: 'Test Recording',
  };

  describe('rendering', () => {
    it('should render video element with correct src', () => {
      render(<VideoPlayer {...defaultProps} />);
      const video = document.querySelector('video');
      expect(video).toBeTruthy();
      expect(video?.src).toBe(defaultProps.src);
    });

    it('should render control buttons', () => {
      render(<VideoPlayer {...defaultProps} />);

      // Play/Pause button
      expect(screen.getByTitle(/play|pause/i)).toBeTruthy();

      // Restart button
      expect(screen.getByTitle(/restart/i)).toBeTruthy();

      // Skip buttons
      expect(screen.getByTitle(/back 5s/i)).toBeTruthy();
      expect(screen.getByTitle(/forward 5s/i)).toBeTruthy();

      // Volume button
      expect(screen.getByTitle(/mute|unmute/i)).toBeTruthy();
    });

    it('should show loading overlay initially', () => {
      render(<VideoPlayer {...defaultProps} />);
      const spinner = document.querySelector('[class*="spinner"]');
      expect(spinner).toBeTruthy();
    });

    it('should show play overlay when paused and loaded', async () => {
      render(<VideoPlayer {...defaultProps} autoPlay={false} />);

      // Trigger loaded metadata
      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      // Since autoPlay is false and video is paused, play overlay should show
      await waitFor(() => {
        const playOverlay = document.querySelector('[class*="playOverlay"]');
        expect(playOverlay).toBeTruthy();
      });
    });
  });

  describe('playback controls', () => {
    it('should toggle play/pause when button is clicked', async () => {
      render(<VideoPlayer {...defaultProps} autoPlay={false} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      const playButton = screen.getByTitle(/play/i);

      act(() => {
        fireEvent.click(playButton);
      });

      expect(mockPlay).toHaveBeenCalled();
    });

    it('should toggle play/pause when video is clicked', async () => {
      render(<VideoPlayer {...defaultProps} autoPlay={false} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      const videoWrapper = document.querySelector('[class*="videoWrapper"]')!;

      act(() => {
        fireEvent.click(videoWrapper);
      });

      expect(mockPlay).toHaveBeenCalled();
    });

    it('should restart video when restart button is clicked', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;
      video.currentTime = 60;

      act(() => {
        fireEvent.loadedMetadata(video);
      });

      const restartButton = screen.getByTitle(/restart/i);

      act(() => {
        fireEvent.click(restartButton);
      });

      expect(video.currentTime).toBe(0);
      expect(mockPlay).toHaveBeenCalled();
    });

    it('should reset video to beginning when ended', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;
      video.currentTime = 120;

      act(() => {
        fireEvent.loadedMetadata(video);
        fireEvent.ended(video);
      });

      expect(video.currentTime).toBe(0);
    });
  });

  describe('volume controls', () => {
    it('should toggle mute when mute button is clicked', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      const muteButton = screen.getByTitle(/mute/i);

      act(() => {
        fireEvent.click(muteButton);
      });

      expect(video.muted).toBe(true);
    });
  });

  describe('time display', () => {
    it('should format time correctly', () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      // Should show 0:00 / 2:00 (duration is mocked to 120 seconds)
      expect(screen.getByText(/0:00.*2:00/)).toBeTruthy();
    });

    it('should update time display during playback', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;

      act(() => {
        fireEvent.loadedMetadata(video);
      });

      // Simulate time update
      video.currentTime = 65; // 1:05
      act(() => {
        fireEvent.timeUpdate(video);
      });

      await waitFor(() => {
        expect(screen.getByText(/1:05.*2:00/)).toBeTruthy();
      });
    });
  });

  describe('keyboard shortcuts', () => {
    it('should toggle play/pause on Space key', async () => {
      render(<VideoPlayer {...defaultProps} autoPlay={false} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });

      expect(mockPlay).toHaveBeenCalled();
    });

    it('should toggle play/pause on K key', async () => {
      render(<VideoPlayer {...defaultProps} autoPlay={false} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      act(() => {
        fireEvent.keyDown(window, { key: 'k' });
      });

      expect(mockPlay).toHaveBeenCalled();
    });

    it('should skip backward on ArrowLeft', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;

      // First trigger loadedMetadata so isLoaded becomes true
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      // Set currentTime and trigger time update so component knows current position
      video.currentTime = 30;
      act(() => {
        fireEvent.timeUpdate(video);
      });

      // Now skip backward
      act(() => {
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
      });

      // The component should set currentTime to 25 (30 - 5)
      expect(video.currentTime).toBe(25);
    });

    it('should skip forward on ArrowRight', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;

      // First trigger loadedMetadata so isLoaded becomes true
      act(() => {
        fireEvent.loadedMetadata(video);
      });

      // Set currentTime and trigger time update so component knows current position
      video.currentTime = 30;
      act(() => {
        fireEvent.timeUpdate(video);
      });

      // Now skip forward
      act(() => {
        fireEvent.keyDown(window, { key: 'ArrowRight' });
      });

      // The component should set currentTime to 35 (30 + 5)
      expect(video.currentTime).toBe(35);
    });

    it('should toggle mute on M key', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
        fireEvent.keyDown(window, { key: 'm' });
      });

      expect(video.muted).toBe(true);
    });

    it('should call onClose on Escape key', async () => {
      const onClose = vi.fn();
      render(<VideoPlayer {...defaultProps} onClose={onClose} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.loadedMetadata(video);
        fireEvent.keyDown(window, { key: 'Escape' });
      });

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should show error overlay on video error', async () => {
      const onError = vi.fn();
      render(<VideoPlayer {...defaultProps} onError={onError} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.error(video);
      });

      await waitFor(() => {
        expect(screen.getByText(/failed to load video/i)).toBeTruthy();
      });
      expect(onError).toHaveBeenCalled();
    });

    it('should disable controls on error', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;
      act(() => {
        fireEvent.error(video);
      });

      await waitFor(() => {
        const playButton = screen.getByTitle(/play/i);
        expect(playButton).toBeDisabled();
      });
    });
  });

  describe('progress bar', () => {
    it('should render progress bar', () => {
      render(<VideoPlayer {...defaultProps} />);

      const progressTrack = document.querySelector('[class*="progressTrack"]');
      expect(progressTrack).toBeTruthy();
    });

    it('should update progress bar width based on current time', async () => {
      render(<VideoPlayer {...defaultProps} />);

      const video = document.querySelector('video')!;

      act(() => {
        fireEvent.loadedMetadata(video);
      });

      video.currentTime = 60; // 50% of 120 seconds
      act(() => {
        fireEvent.timeUpdate(video);
      });

      await waitFor(() => {
        const progressFilled = document.querySelector('[class*="progressFilled"]') as HTMLElement;
        expect(progressFilled?.style.width).toBe('50%');
      });
    });
  });
});
