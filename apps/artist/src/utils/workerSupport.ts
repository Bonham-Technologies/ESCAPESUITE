/**
 * Web Worker support detection utilities
 * Used to determine if export can use worker offloading
 */

/**
 * Check if Web Workers are available and not blocked by CSP
 * Air-gapped environments may block workers due to security policies
 */
export function canUseExportWorker(): boolean {
  // Check for Web Worker support
  if (typeof Worker === 'undefined') {
    return false;
  }

  // Check for OfflineAudioContext (needed for audio mixing in worker)
  if (typeof OfflineAudioContext === 'undefined') {
    return false;
  }

  // Try to create a test worker to check if CSP allows it
  try {
    const testCode = 'self.postMessage("ok")';
    const blob = new Blob([testCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const testWorker = new Worker(url);

    // Set up cleanup with timeout
    const cleanup = () => {
      try {
        testWorker.terminate();
        URL.revokeObjectURL(url);
      } catch {
        // Ignore cleanup errors
      }
    };

    // Give it a short time to fail if blocked
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(true); // Assume it works if no error in 100ms
      }, 100);

      testWorker.onmessage = () => {
        clearTimeout(timeout);
        cleanup();
        resolve(true);
      };

      testWorker.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        resolve(false);
      };
    }) as unknown as boolean; // Synchronous check for initial call
  } catch {
    return false;
  }
}

/**
 * Async version of worker support check with actual verification
 */
export async function canUseExportWorkerAsync(): Promise<boolean> {
  // Check for Web Worker support
  if (typeof Worker === 'undefined') {
    return false;
  }

  // Check for OfflineAudioContext
  if (typeof OfflineAudioContext === 'undefined') {
    return false;
  }

  // Try to create and communicate with a test worker
  try {
    const testCode = 'self.onmessage = () => self.postMessage("ok")';
    const blob = new Blob([testCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    return new Promise<boolean>((resolve) => {
      try {
        const testWorker = new Worker(url);

        const timeout = setTimeout(() => {
          testWorker.terminate();
          URL.revokeObjectURL(url);
          resolve(false); // Timeout = probably blocked
        }, 500);

        testWorker.onmessage = (e) => {
          clearTimeout(timeout);
          testWorker.terminate();
          URL.revokeObjectURL(url);
          resolve(e.data === 'ok');
        };

        testWorker.onerror = () => {
          clearTimeout(timeout);
          testWorker.terminate();
          URL.revokeObjectURL(url);
          resolve(false);
        };

        // Send message to trigger response
        testWorker.postMessage('test');
      } catch {
        URL.revokeObjectURL(url);
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

// Cache the result after first async check
let workerSupportCached: boolean | null = null;

/**
 * Get cached worker support status, running async check if needed
 */
export async function getWorkerSupport(): Promise<boolean> {
  if (workerSupportCached !== null) {
    return workerSupportCached;
  }

  workerSupportCached = await canUseExportWorkerAsync();
  return workerSupportCached;
}

/**
 * Reset cached worker support (for testing)
 */
export function resetWorkerSupportCache(): void {
  workerSupportCached = null;
}
