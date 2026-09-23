import type { RefObject } from 'react';
import type { RecordingState } from '../../store/types';
import { ScreenIcon } from '../icons';
import { CountdownOverlay } from './CountdownOverlay';
import styles from '../../App.module.css';

interface RecordingPreviewProps {
  /** True once the compositor is running: its canvas is shown in place of a video. */
  isPiPActive: boolean;
  /** The single-source stream to mirror when there is no compositor. */
  previewStream: MediaStream | null;
  state: RecordingState;
  /**
   * The `<video>` the App attaches `previewStream` to. It stays the App's ref
   * rather than this component's, because the preview-attach effect and the
   * end-of-take thumbnail capture both read the element.
   */
  previewRef: RefObject<HTMLVideoElement | null>;
  /** The host element the App moves the compositor's canvas into, for the same reason. */
  canvasPreviewRef: RefObject<HTMLDivElement | null>;
}

/**
 * The preview stage: one of three things — the compositor's canvas, a mirrored
 * stream, or the idle placeholder — with the countdown laid over the top.
 *
 * The three are mutually exclusive and checked in that order, because during a
 * picture-in-picture take `previewStream` is set as well; PiP wins so the
 * compositor's output is shown directly instead of a stream that has been
 * through an encode/decode round-trip.
 *
 * Both DOM handles belong to the App, so this component only places them.
 */
export function RecordingPreview({
  isPiPActive,
  previewStream,
  state,
  previewRef,
  canvasPreviewRef,
}: RecordingPreviewProps) {
  return (
    <div className={styles.previewContainer}>
      <div className={styles.preview}>
        {isPiPActive ? (
          // PiP mode: show compositor canvas directly — avoids encode/decode round-trip
          <div
            ref={canvasPreviewRef}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          />
        ) : previewStream ? (
          <video
            ref={previewRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div className={styles.previewPlaceholder}>
            <ScreenIcon className={styles.previewIcon} />
            <p>Click record to start capturing</p>
          </div>
        )}

        {/* Countdown overlay — it reads the number from the store itself, so
            each tick re-renders the overlay and not this stage */}
        <CountdownOverlay state={state} />
      </div>
    </div>
  );
}
