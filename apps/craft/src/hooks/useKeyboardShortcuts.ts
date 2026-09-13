// The recorder's window-level keyboard shortcuts: R, P, S and Escape, each
// gated on the state the app is in.
//
// One effect, and the only window listener App itself binds (VideoPlayer binds its own while the playback dialog is open). Its dependency array
// is the whole set of handlers plus `state`, so the listener is torn down and
// re-bound whenever any of them changes identity — including on every change
// to `config`, which handleStartRecording depends on. That is the behaviour as
// it stands; the array is copied verbatim rather than trimmed.
import { useEffect } from 'react';
import type { RecordingState } from '../store/types';

export interface KeyboardShortcutsDeps {
  state: RecordingState;
  handleStartRecording: () => void;
  handlePauseRecording: () => void;
  handleResumeRecording: () => void;
  handleStopRecording: () => void;
  cancelCountdown: () => void;
  handleCancelRecording: () => void;
}

export function useKeyboardShortcuts({
  state,
  handleStartRecording,
  handlePauseRecording,
  handleResumeRecording,
  handleStopRecording,
  cancelCountdown,
  handleCancelRecording,
}: KeyboardShortcutsDeps): void {
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'r':
          if (state === 'idle') {
            handleStartRecording();
          }
          break;
        case 'p':
          if (state === 'recording') {
            handlePauseRecording();
          } else if (state === 'paused') {
            handleResumeRecording();
          }
          break;
        case 's':
          if (state === 'recording' || state === 'paused') {
            handleStopRecording();
          }
          break;
        case 'escape':
          if (state === 'countdown') {
            cancelCountdown();
          } else if (state !== 'idle') {
            handleCancelRecording();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, handleStartRecording, handlePauseRecording, handleResumeRecording, handleStopRecording, cancelCountdown, handleCancelRecording]);
}
