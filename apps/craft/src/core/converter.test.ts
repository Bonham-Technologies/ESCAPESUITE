import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isMP4ConversionSupported } from './converter';

// Mock WebCodecs APIs
const mockVideoEncoder = vi.fn();
const mockAudioEncoder = vi.fn();
const mockVideoFrame = vi.fn();
const mockAudioContext = vi.fn();

describe('converter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isMP4ConversionSupported', () => {
    it('returns true when all WebCodecs APIs are available', () => {
      vi.stubGlobal('VideoEncoder', mockVideoEncoder);
      vi.stubGlobal('AudioEncoder', mockAudioEncoder);
      vi.stubGlobal('VideoFrame', mockVideoFrame);
      vi.stubGlobal('AudioContext', mockAudioContext);

      expect(isMP4ConversionSupported()).toBe(true);
    });

    it('returns false when VideoEncoder is not available', () => {
      vi.stubGlobal('VideoEncoder', undefined);
      vi.stubGlobal('AudioEncoder', mockAudioEncoder);
      vi.stubGlobal('VideoFrame', mockVideoFrame);
      vi.stubGlobal('AudioContext', mockAudioContext);

      expect(isMP4ConversionSupported()).toBe(false);
    });

    it('returns false when AudioEncoder is not available', () => {
      vi.stubGlobal('VideoEncoder', mockVideoEncoder);
      vi.stubGlobal('AudioEncoder', undefined);
      vi.stubGlobal('VideoFrame', mockVideoFrame);
      vi.stubGlobal('AudioContext', mockAudioContext);

      expect(isMP4ConversionSupported()).toBe(false);
    });

    it('returns false when VideoFrame is not available', () => {
      vi.stubGlobal('VideoEncoder', mockVideoEncoder);
      vi.stubGlobal('AudioEncoder', mockAudioEncoder);
      vi.stubGlobal('VideoFrame', undefined);
      vi.stubGlobal('AudioContext', mockAudioContext);

      expect(isMP4ConversionSupported()).toBe(false);
    });

    it('returns false when AudioContext is not available', () => {
      vi.stubGlobal('VideoEncoder', mockVideoEncoder);
      vi.stubGlobal('AudioEncoder', mockAudioEncoder);
      vi.stubGlobal('VideoFrame', mockVideoFrame);
      vi.stubGlobal('AudioContext', undefined);

      expect(isMP4ConversionSupported()).toBe(false);
    });

    it('returns false when all APIs are missing', () => {
      vi.stubGlobal('VideoEncoder', undefined);
      vi.stubGlobal('AudioEncoder', undefined);
      vi.stubGlobal('VideoFrame', undefined);
      vi.stubGlobal('AudioContext', undefined);

      expect(isMP4ConversionSupported()).toBe(false);
    });
  });

  describe('convertToMP4', () => {
    it('throws when WebCodecs is not supported', async () => {
      vi.stubGlobal('VideoEncoder', undefined);

      const { convertToMP4 } = await import('./converter');

      await expect(
        convertToMP4(new Blob(['test']), vi.fn())
      ).rejects.toThrow('MP4 conversion requires WebCodecs API');
    });
  });
});
