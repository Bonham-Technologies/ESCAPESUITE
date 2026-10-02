// sessionSnapshot on its own: a real store state (via the projectStore
// fixtures), no App and no autosave timer.
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/projectStore';
import { resetStoreForTest, store, addClip, video } from '../test/fixtures/projectStore';
import { buildSessionSnapshot } from './sessionSnapshot';

beforeEach(() => {
  resetStoreForTest();
});

describe('buildSessionSnapshot', () => {
  it('carries every field through from the store state, using the given timestamp', () => {
    const clip = addClip('clip1', 0);
    store().setCurrentTime(3.5);
    store().setSelectedClipId(clip.id);
    store().setZoom(2);

    const state = useEditorStore.getState();
    const snapshot = buildSessionSnapshot(state, 123456789);

    expect(snapshot).toEqual({
      project: state.project,
      sourceVideos: state.sourceVideos,
      currentTime: 3.5,
      selectedClipId: clip.id,
      zoom: 2,
      timestamp: 123456789,
    });
  });

  it('takes the timestamp from the argument, not Date.now()', () => {
    const state = useEditorStore.getState();
    const snapshot = buildSessionSnapshot(state, 42);
    expect(snapshot.timestamp).toBe(42);
  });

  it('never persists a thumbnail object-URL handle — it dies with the document', () => {
    store().addSourceVideo({ ...video, thumbnailUrl: 'blob:live-handle' });

    const snapshot = buildSessionSnapshot(useEditorStore.getState(), 1);

    expect(snapshot.sourceVideos[0].thumbnailUrl).toBeUndefined();
    expect(Object.keys(snapshot.sourceVideos[0])).not.toContain('thumbnailUrl');
  });

  it('carries a clip mask and stroke through, because it carries the project whole', () => {
    const clip = addClip('clip1', 0);
    store().updateClip(clip.id, {
      mask: { kind: 'circle' },
      stroke: { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
    });

    const snapshot = buildSessionSnapshot(useEditorStore.getState(), 1);

    // The snapshot is `state.project` by reference, so autosave and restore get
    // ESCSUITE-65 for free and `DB_VERSION` stays 1. Asserted rather than
    // assumed: a future snapshot that picked fields out of the project one by
    // one would drop these two silently.
    const restored = snapshot.project.timeline.clips[0];
    expect(restored.mask).toEqual({ kind: 'circle' });
    expect(restored.stroke).toEqual({ color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 });
  });

  it('carries a clip crop through a snapshot round trip (ESCSUITE-6)', () => {
    // The snapshot takes `state.project` whole, so this needs no code — and
    // needs this test, because "needs no code" is exactly the claim that rots.
    const clip = addClip('clip1', 0);
    const crop = { left: 0.25, top: 0.1, right: 0, bottom: 0 };
    store().updateClip(clip.id, { crop });

    const snapshot = buildSessionSnapshot(useEditorStore.getState(), 1);

    const restoredClip = snapshot.project.timeline.clips[0];
    expect(restoredClip.crop).toEqual(crop);
  });
});
