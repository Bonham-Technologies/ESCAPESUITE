// pruneSelection's own unit tests (ESCSUITE-101) — no store, just the pure
// question, the way trackLock.test.ts covers trackLock.ts.
import { describe, it, expect } from 'vitest';
import { pruneSelection } from './selectionPrune';
import type { Clip } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION } from './types';

const clip = (id: string): Clip => ({
  id, sourceVideoId: 'v', name: id, startTime: 0, endTime: 1, duration: 1, trackId: 't',
  timelinePosition: 0, blendMode: 'normal', transform: { ...DEFAULT_TRANSFORM },
  effects: { ...DEFAULT_EFFECTS }, transition: { ...DEFAULT_TRANSITION },
});

describe('pruneSelection', () => {
  it('drops a selectedClipIds member that names no clip', () => {
    const clips = [clip('a')];
    const result = pruneSelection(clips, null, new Set(['a', 'ghost']));
    expect([...result.selectedClipIds]).toEqual(['a']);
  });

  it('nulls selectedClipId when it names no clip', () => {
    const clips = [clip('a')];
    const result = pruneSelection(clips, 'ghost', new Set());
    expect(result.selectedClipId).toBeNull();
  });

  it('leaves selectedClipId alone when it still names a clip', () => {
    const clips = [clip('a')];
    const result = pruneSelection(clips, 'a', new Set(['a']));
    expect(result.selectedClipId).toBe('a');
  });

  it('leaves selectedClipId null when it already was', () => {
    const clips = [clip('a')];
    const result = pruneSelection(clips, null, new Set());
    expect(result.selectedClipId).toBeNull();
  });

  it('drops every ghost while keeping every survivor, order preserved by Set semantics', () => {
    const clips = [clip('a'), clip('c')];
    const result = pruneSelection(clips, 'b', new Set(['a', 'b', 'c']));
    expect([...result.selectedClipIds]).toEqual(['a', 'c']);
    expect(result.selectedClipId).toBeNull(); // 'b' is gone
  });

  it('is a no-op against an empty timeline with an empty selection', () => {
    const result = pruneSelection([], null, new Set());
    expect(result.selectedClipId).toBeNull();
    expect(result.selectedClipIds.size).toBe(0);
  });

  describe('reference stability', () => {
    it('returns the SAME selectedClipIds Set when nothing is pruned', () => {
      const clips = [clip('a'), clip('b')];
      const selectedClipIds = new Set(['a', 'b']);
      const result = pruneSelection(clips, 'a', selectedClipIds);
      expect(result.selectedClipIds).toBe(selectedClipIds);
    });

    it('returns the SAME selectedClipIds Set when the selection is empty', () => {
      const clips = [clip('a')];
      const selectedClipIds = new Set<string>();
      const result = pruneSelection(clips, null, selectedClipIds);
      expect(result.selectedClipIds).toBe(selectedClipIds);
    });

    it('returns a DIFFERENT selectedClipIds Set when a member was dropped', () => {
      const clips = [clip('a')];
      const selectedClipIds = new Set(['a', 'ghost']);
      const result = pruneSelection(clips, null, selectedClipIds);
      expect(result.selectedClipIds).not.toBe(selectedClipIds);
    });
  });
});
