/**
 * Tests for Web Worker support detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  canUseExportWorkerAsync,
  getWorkerSupport,
  resetWorkerSupportCache,
} from './workerSupport';
import { installWorkerDouble, type WorkerDouble } from '../test/doubles/worker';
import { removeGlobal } from '../test/doubles/globals';

describe('workerSupport', () => {
  beforeEach(() => {
    resetWorkerSupportCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('canUseExportWorkerAsync', () => {
    let worker: WorkerDouble;

    beforeEach(() => {
      worker = installWorkerDouble({ kind: 'reply', data: 'ok' });
    });

    afterEach(() => {
      worker.uninstall();
    });

    it('returns false when Worker is undefined', async () => {
      const restore = removeGlobal('Worker');
      try {
        await expect(canUseExportWorkerAsync()).resolves.toBe(false);
      } finally {
        restore();
      }
    });

    it('returns false when OfflineAudioContext is undefined', async () => {
      const restore = removeGlobal('OfflineAudioContext');
      try {
        await expect(canUseExportWorkerAsync()).resolves.toBe(false);
      } finally {
        restore();
      }
    });

    it('posts the probe message and reports true when the worker answers "ok"', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL');

      await expect(canUseExportWorkerAsync()).resolves.toBe(true);

      expect(worker.posted).toEqual(['test']);
      // The probe script it shipped really checks OfflineAudioContext in-worker.
      expect(worker.terminated).toBe(1);
      expect(revoke).toHaveBeenCalledWith('blob:mock-url');
    });

    it('reports false when the worker says it has no OfflineAudioContext', async () => {
      worker.behaviour = { kind: 'reply', data: 'no-audio-context' };
      await expect(canUseExportWorkerAsync()).resolves.toBe(false);
      expect(worker.terminated).toBe(1);
    });

    it('reports false when the worker errors', async () => {
      worker.behaviour = { kind: 'error' };
      await expect(canUseExportWorkerAsync()).resolves.toBe(false);
      expect(worker.terminated).toBe(1);
    });

    it('reports false and cleans up when the worker never answers within a second', async () => {
      vi.useFakeTimers();
      worker.behaviour = { kind: 'silent' };

      const promise = canUseExportWorkerAsync();
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(false);
      expect(worker.terminated).toBe(1);
    });

    it('reports false and revokes the URL when the worker cannot be constructed', async () => {
      worker.behaviour = { kind: 'throwOnConstruct' };
      const revoke = vi.spyOn(URL, 'revokeObjectURL');

      await expect(canUseExportWorkerAsync()).resolves.toBe(false);
      expect(revoke).toHaveBeenCalledWith('blob:mock-url');
    });

    it('reports false when the probe script cannot even be turned into a URL', async () => {
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        throw new Error('blob URLs blocked');
      });
      try {
        await expect(canUseExportWorkerAsync()).resolves.toBe(false);
        expect(worker.urls).toEqual([]);
      } finally {
        createObjectURL.mockRestore();
      }
    });
  });

  describe('getWorkerSupport', () => {
    it('runs the probe once and reuses the answer', async () => {
      const worker = installWorkerDouble({ kind: 'reply', data: 'ok' });
      try {
        await expect(getWorkerSupport()).resolves.toBe(true);
        await expect(getWorkerSupport()).resolves.toBe(true);
        // Second call answered from cache: no second worker.
        expect(worker.urls).toHaveLength(1);
      } finally {
        worker.uninstall();
      }
    });

    it('caches a negative answer too, and re-probes after a reset', async () => {
      const worker = installWorkerDouble({ kind: 'reply', data: 'no-audio-context' });
      try {
        await expect(getWorkerSupport()).resolves.toBe(false);
        await expect(getWorkerSupport()).resolves.toBe(false);
        expect(worker.urls).toHaveLength(1);

        resetWorkerSupportCache();
        worker.behaviour = { kind: 'reply', data: 'ok' };
        await expect(getWorkerSupport()).resolves.toBe(true);
        expect(worker.urls).toHaveLength(2);
      } finally {
        worker.uninstall();
      }
    });
  });
});
