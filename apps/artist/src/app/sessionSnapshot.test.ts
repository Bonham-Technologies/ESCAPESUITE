// sessionSnapshot on its own: a real store state (via the projectStore
// fixtures), no App and no autosave timer.
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/projectStore';
import { resetStoreForTest, store, addClip, video } from '../test/fixtures/projectStore';
import { buildSessionSnapshot, isEmptySession } from './sessionSnapshot';

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
      editor: { inPoint: null, outPoint: null, markers: [] },
      timestamp: 123456789,
    });
  });

  it('writes the in/out points and the markers as the editor block (ESCSUITE-245)', () => {
    store().setInPoint(1);
    store().setOutPoint(4);
    store().addMarker(7, 'late');
    store().addMarker(2, 'early');

    const snapshot = buildSessionSnapshot(useEditorStore.getState(), 1);

    expect(snapshot.editor).toEqual({
      inPoint: 1,
      outPoint: 4,
      markers: useEditorStore.getState().markers,
    });
    expect(snapshot.editor!.markers.map((m) => m.label)).toEqual(['early', 'late']);
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

// ESCSUITE-227: an empty project never overwrites a populated slot, so the
// autosave asks this before it writes. "Empty" is both lists empty — a clip
// with no source (a text overlay) is work, and so is a source with no clip.
describe('isEmptySession', () => {
  const emptyState = () => {
    store().resetProject();
    return useEditorStore.getState();
  };

  it('is empty with no sources and no clips', () => {
    expect(isEmptySession(buildSessionSnapshot(emptyState(), 1))).toBe(true);
  });

  it('is not empty with a source and no clip', () => {
    // resetStoreForTest leaves the fixture's one source in the library.
    expect(useEditorStore.getState().sourceVideos).toHaveLength(1);
    expect(isEmptySession(buildSessionSnapshot(useEditorStore.getState(), 1))).toBe(false);
  });

  it('is not empty with a clip and no source', () => {
    addClip('clip1', 0);
    const withClip = { ...buildSessionSnapshot(useEditorStore.getState(), 1), sourceVideos: [] };

    expect(withClip.project.timeline.clips).toHaveLength(1);
    expect(isEmptySession(withClip)).toBe(false);
  });
});
