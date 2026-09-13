// sessionSnapshot on its own: a real store state (via the projectStore
// fixtures), no App and no autosave timer.
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/projectStore';
import { resetStoreForTest, store, addClip } from '../test/fixtures/projectStore';
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
});
