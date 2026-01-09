/**
 * Tests for Web Worker support detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canUseExportWorker, resetWorkerSupportCache } from './workerSupport';

describe('workerSupport', () => {
  beforeEach(() => {
    resetWorkerSupportCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('canUseExportWorker', () => {
    it('returns false when Worker is undefined', () => {
      const originalWorker = globalThis.Worker;
      // @ts-expect-error - testing undefined
      globalThis.Worker = undefined;

      const result = canUseExportWorker();
      expect(result).toBe(false);

      globalThis.Worker = originalWorker;
    });

    it('returns false when OfflineAudioContext is undefined', () => {
      const originalContext = globalThis.OfflineAudioContext;
      // @ts-expect-error - testing undefined
      globalThis.OfflineAudioContext = undefined;

      const result = canUseExportWorker();
      expect(result).toBe(false);

      globalThis.OfflineAudioContext = originalContext;
    });

    it('returns false when Worker constructor throws', () => {
      const originalWorker = globalThis.Worker;
      globalThis.Worker = class {
        constructor() {
          throw new Error('CSP blocked');
        }
      } as unknown as typeof Worker;

      const result = canUseExportWorker();
      expect(result).toBe(false);

      globalThis.Worker = originalWorker;
    });
  });

  // Note: canUseExportWorkerAsync and getWorkerSupport require actual Worker execution
  // which is not fully supported in jsdom. These would need browser-based testing.
  describe('async worker support', () => {
    it.todo('canUseExportWorkerAsync returns true when worker communication succeeds');
    it.todo('canUseExportWorkerAsync returns false on timeout');
    it.todo('getWorkerSupport caches the result');
  });
});
