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

  describe('all media imports at 100% native scale', () => {
    it('should import a 4000x3000 image at scale 1 (native size)', () => {
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
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });

    it('should import a wide panorama image at scale 1', () => {
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
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });
  });

  describe('small images also import at native scale', () => {
    it('should import a 150x100 image at scale 1', () => {
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
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });

    it('should import an image exactly matching the canvas at scale 1', () => {
      const source = createSourceVideo({
        id: 'img-exact',
        name: 'exact.png',
        width: 1920,
        height: 1080,
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
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });
  });

  describe('videos import at native scale', () => {
    it('should import a 4K video at scale 1 on 1080p project', () => {
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
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });

    it('should import a 720p video at scale 1 on 1080p project', () => {
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
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
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
    it('should import at scale 1 regardless of project resolution', () => {
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
      expect(clip.transform.scaleX).toBe(1);
      expect(clip.transform.scaleY).toBe(1);
    });
  });
});
