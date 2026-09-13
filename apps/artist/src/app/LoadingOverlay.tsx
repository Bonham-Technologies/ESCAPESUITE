import styles from '../App.module.css';

/**
 * The modal spinner shown while a project loads.
 *
 * The `{isLoading && …}` guard stays in `App`, so this renders only when
 * there is something to wait for.
 */
export function LoadingOverlay() {
  return (
    <div className={styles.loadingOverlay} role="dialog" aria-modal="true" aria-labelledby="loading-message">
      <div className={styles.spinner} aria-hidden="true" />
      <p id="loading-message">Loading project...</p>
    </div>
  );
}
