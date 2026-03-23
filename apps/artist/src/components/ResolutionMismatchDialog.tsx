import styles from './ResolutionMismatchDialog.module.css';

interface ResolutionMismatchDialogProps {
  isOpen: boolean;
  mediaName: string;
  mediaDimensions: { width: number; height: number };
  projectDimensions: { width: number; height: number };
  onScaleToFit: () => void;
  onKeepOriginal: () => void;
}

export function ResolutionMismatchDialog({
  isOpen,
  mediaName,
  mediaDimensions,
  projectDimensions,
  onScaleToFit,
  onKeepOriginal,
}: ResolutionMismatchDialogProps) {
  if (!isOpen) return null;

  const mediaPixels = mediaDimensions.width * mediaDimensions.height;
  const projectPixels = projectDimensions.width * projectDimensions.height;
  const sizeComparison = mediaPixels > projectPixels ? 'larger' : 'smaller';

  // Determine media type from name extension
  const extension = mediaName.split('.').pop()?.toLowerCase() || '';
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
  const mediaType = imageExtensions.includes(extension) ? 'image' : 'video';

  return (
    <div className={styles.overlay} data-testid="resolution-mismatch-dialog">
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h3 className={styles.title}>Resolution Mismatch</h3>
        </div>
        <div className={styles.body}>
          <p className={styles.message}>
            This {mediaType} ({mediaDimensions.width}x{mediaDimensions.height}) is {sizeComparison} than
            your project ({projectDimensions.width}x{projectDimensions.height}). Scale to fit?
          </p>
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              onClick={onKeepOriginal}
            >
              Keep Original Size
            </button>
            <button
              className={styles.primaryButton}
              onClick={onScaleToFit}
            >
              Scale to Fit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
