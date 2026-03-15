import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../projectStore';
import type { SourceVideo } from '../types';

function createSourceVideo(overrides: Partial<SourceVideo> = {}): SourceVideo {
  return {
    id: 'source-1',
    name: 'test.mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/mp4',
    size: 1000000,
    mediaType: 'video',
    ...overrides,
  };
}

describe('Image Scaling Relative to Project Resolution', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject();
    useEditorStore.getState().clearHistory();
  });

  describe('large images are auto-fit scaled down', () => {
    it('should scale a 4000x3000 image to fit within 1280x720 canvas', () => {
      const source = createSourceVideo({
        id: 'img-large',
        name: 'large.png',
        width: 4000,
        height: 3000,
        mediaType: 'image',
        mimeType: 'image/png',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-large',
        sourceVideoId: 'img-large',
        name: 'large.png',
        startTime: 0,
        endTime: 5,
        duration: 5,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-large')!;
      // fitScale = min(1280/4000, 720/3000) = min(0.32, 0.24) = 0.24
      const expectedScale = Math.min(1280 / 4000, 720 / 3000);
      expect(clip.transform.scaleX).toBeCloseTo(expectedScale);
      expect(clip.transform.scaleY).toBeCloseTo(expectedScale);
    });

    it('should scale a wide panorama image to fit', () => {
      const source = createSourceVideo({
        id: 'img-wide',
        name: 'panorama.jpg',
        width: 5000,
        height: 500,
        mediaType: 'image',
        mimeType: 'image/jpeg',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-wide',
        sourceVideoId: 'img-wide',
        name: 'panorama.jpg',
        startTime: 0,
        endTime: 5,
        duration: 5,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-wide')!;
      // fitScale = min(1280/5000, 720/500) = min(0.256, 1.44) = 0.256
      const expectedScale = Math.min(1280 / 5000, 720 / 500);
      expect(clip.transform.scaleX).toBeCloseTo(expectedScale);
      expect(clip.transform.scaleY).toBeCloseTo(expectedScale);
    });
  });

  describe('small images keep native scale', () => {
    it('should keep native scale for a 150x100 image on 1280x720 project', () => {
      const source = createSourceVideo({
        id: 'img-small',
        name: 'icon.png',
        width: 150,
        height: 100,
        mediaType: 'image',
        mimeType: 'image/png',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-small',
        sourceVideoId: 'img-small',
        name: 'icon.png',
        startTime: 0,
        endTime: 5,
        duration: 5,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-small')!;
      // nativeScaleX = 150/1280, nativeScaleY = 100/720 — both < 1, so keep native
      expect(clip.transform.scaleX).toBeCloseTo(150 / 1280);
      expect(clip.transform.scaleY).toBeCloseTo(100 / 720);
    });

    it('should keep native scale for an image exactly matching the canvas', () => {
      const source = createSourceVideo({
        id: 'img-exact',
        name: 'exact.png',
        width: 1280,
        height: 720,
        mediaType: 'image',
        mimeType: 'image/png',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-exact',
        sourceVideoId: 'img-exact',
        name: 'exact.png',
        startTime: 0,
        endTime: 5,
        duration: 5,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-exact')!;
      // nativeScale = 1280/1280 = 1, 720/720 = 1 — exactly 1, not > 1, so keep native
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });
  });

  describe('videos are properly scaled', () => {
    it('should auto-fit a 4K video to 720p project', () => {
      const source = createSourceVideo({
        id: 'vid-4k',
        name: '4k-video.mp4',
        width: 3840,
        height: 2160,
        mediaType: 'video',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-4k',
        sourceVideoId: 'vid-4k',
        name: '4k-video.mp4',
        startTime: 0,
        endTime: 10,
        duration: 10,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-4k')!;
      // fitScale = min(1280/3840, 720/2160) = min(0.333, 0.333) = 0.333
      const expectedScale = Math.min(1280 / 3840, 720 / 2160);
      expect(clip.transform.scaleX).toBeCloseTo(expectedScale);
      expect(clip.transform.scaleY).toBeCloseTo(expectedScale);
    });

    it('should keep native scale for a 720p video on 1080p project', () => {
      // Change project resolution to 1080p
      useEditorStore.getState().setProjectResolution(1920, 1080);

      const source = createSourceVideo({
        id: 'vid-720',
        name: '720p-video.mp4',
        width: 1280,
        height: 720,
        mediaType: 'video',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-720',
        sourceVideoId: 'vid-720',
        name: '720p-video.mp4',
        startTime: 0,
        endTime: 10,
        duration: 10,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-720')!;
      // nativeScaleX = 1280/1920 = 0.667, nativeScaleY = 720/1080 = 0.667
      expect(clip.transform.scaleX).toBeCloseTo(1280 / 1920);
      expect(clip.transform.scaleY).toBeCloseTo(720 / 1080);
    });
  });

  describe('audio clips are not affected', () => {
    it('should not scale audio clips (no dimensions)', () => {
      const source = createSourceVideo({
        id: 'audio-1',
        name: 'song.mp3',
        width: 0,
        height: 0,
        mediaType: 'audio',
        mimeType: 'audio/mpeg',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-audio',
        sourceVideoId: 'audio-1',
        name: 'song.mp3',
        startTime: 0,
        endTime: 120,
        duration: 120,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-audio')!;
      // Audio clips should keep default scale of 1
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });
  });

  describe('works with different project resolutions', () => {
    it('should scale relative to 4K project resolution', () => {
      useEditorStore.getState().setProjectResolution(3840, 2160);

      const source = createSourceVideo({
        id: 'img-hd',
        name: 'hd-photo.jpg',
        width: 1920,
        height: 1080,
        mediaType: 'image',
        mimeType: 'image/jpeg',
      });

      const store = useEditorStore.getState();
      store.addSourceVideo(source);
      store.addClipToTimeline({
        id: 'clip-hd',
        sourceVideoId: 'img-hd',
        name: 'hd-photo.jpg',
        startTime: 0,
        endTime: 5,
        duration: 5,
      });

      const clip = useEditorStore.getState().project.timeline.clips.find(c => c.id === 'clip-hd')!;
      // On 4K canvas, 1920x1080 is smaller: nativeScaleX = 1920/3840 = 0.5
      expect(clip.transform.scaleX).toBeCloseTo(0.5);
      expect(clip.transform.scaleY).toBeCloseTo(0.5);
    });
  });
});
