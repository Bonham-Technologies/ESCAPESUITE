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
  /** False while the Record button itself is disabled; R must agree with it. */
  canRecord: boolean;
  /**
   * True while either modal is on screen. A dialog is modal, so nothing behind
   * it may act on a key — R in particular used to put a screen-capture prompt
   * up from inside the Help dialog. The dialog's own keys (Escape, Tab) never
   * reach this listener at all: `useDialogBehaviour` stops them in the capture
   * phase, above the window.
   */
  modalOpen: boolean;
  handleStartRecording: () => void;
  handlePauseRecording: () => void;
  handleResumeRecording: () => void;
  handleStopRecording: () => void;
  cancelCountdown: () => void;
  handleCancelRecording: () => void;
}

export function useKeyboardShortcuts({
  state,
  canRecord,
  modalOpen,
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

      // A modal is in front; the app behind it is not taking keys.
      if (modalOpen) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'r':
          if (state === 'idle' && canRecord) {
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
          } else if (state !== 'idle' && state !== 'saving') {
            // 'saving' is excluded for the same reason as 'idle': there is
            // nothing left to cancel (ESCSUITE-174). The take has already
            // stopped and only the write to storage remains, and the save does
            // not read `cancelledRef` — so a cancel here could not call the
            // write off, it could only put the app back to 'idle' behind it:
            // the sidebar unlocked mid-write, and Record live again, with the
            // finished save's own 'idle' then landing on whatever take was
            // started in the meantime. Same posture the Record button takes in
            // 'preparing'/'saving' (ESCSUITE-106). 'preparing' stays
            // cancellable: there, the capture request is still outstanding and
            // the attempt token makes the cancel stick (ESCSUITE-93/109).
            handleCancelRecording();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, canRecord, modalOpen, handleStartRecording, handlePauseRecording, handleResumeRecording, handleStopRecording, cancelCountdown, handleCancelRecording]);
}
