import { describe, it, expect } from 'vitest';
import {
  cloneClip,
  cloneProject,
  cloneSourceVideos,
  createUndoableSnapshot,
  deepClone,
} from './deepClone';
import type { Clip, Project, SourceVideo } from '../store/types';

const clip = (): Clip => ({
  id: 'clip1',
  sourceVideoId: 'video1',
  name: 'Clip 1',
  startTime: 0,
  endTime: 5,
  duration: 5,
  trackId: 'track1',
  timelinePosition: 0,
  blendMode: 'normal',
  transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  effects: { blur: 0 },
  transition: { type: 'none', duration: 0 },
});

const project = (): Project => ({
  id: 'p1',
  name: 'Project',
  created: 1,
  modified: 2,
  resolution: { width: 1920, height: 1080 },
  timeline: {
    tracks: [
      { id: 'track1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
    ],
    clips: [clip()],
    textOverlays: [],
    shapeOverlays: [],
    duration: 5,
  },
});

const sourceVideos = (): SourceVideo[] => [
  {
    id: 'video1',
    name: 'v.mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/mp4',
    size: 100,
    waveformData: [{ min: -1, max: 1 }],
  },
];

describe('deepClone', () => {
  it('copies nested values without sharing references', () => {
    const original = { a: { b: [1, 2, { c: 3 }] } };
    const copy = deepClone(original);

    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.a).not.toBe(original.a);
    expect(copy.a.b[2]).not.toBe(original.a.b[2]);
  });

  it('preserves the values JSON round-tripping would lose', () => {
    const copy = deepClone({ missing: undefined, nan: NaN, infinite: Infinity, when: new Date(0) });

    expect('missing' in copy).toBe(true);
    expect(copy.missing).toBeUndefined();
    expect(Number.isNaN(copy.nan)).toBe(true);
    expect(copy.infinite).toBe(Infinity);
    expect(copy.when).toBeInstanceOf(Date);
  });

  it('reproduces a circular reference in the copy rather than choking on it', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const copy = deepClone(circular) as Record<string, unknown>;

    expect(copy).not.toBe(circular);
    // The cycle is rebuilt inside the clone, pointing at the clone.
    expect(copy.self).toBe(copy);
  });
});

describe('cloneProject', () => {
  it('detaches the timeline so edits to the copy leave the original alone', () => {
    const original = project();
    const copy = cloneProject(original);

    copy.timeline.clips[0].timelinePosition = 42;
    copy.timeline.tracks[0].name = 'Renamed';

    expect(original.timeline.clips[0].timelinePosition).toBe(0);
    expect(original.timeline.tracks[0].name).toBe('Track 1');
    expect(copy.id).toBe('p1');
  });
});

describe('cloneSourceVideos', () => {
  it('detaches every source and its waveform data', () => {
    const original = sourceVideos();
    const copy = cloneSourceVideos(original);

    copy[0].waveformData![0].max = 0;

    expect(original[0].waveformData![0].max).toBe(1);
    expect(original).toEqual(sourceVideos());
    expect(copy[0]).not.toBe(original[0]);
  });
});

describe('cloneClip', () => {
  it('detaches the transform and effects of the copy', () => {
    const original = clip();
    const copy = cloneClip(original);

    copy.transform.x = 0.1;
    copy.effects.blur = 8;

    expect(original.transform.x).toBe(0.5);
    expect(original.effects.blur).toBe(0);
  });
});

describe('createUndoableSnapshot', () => {
  it('snapshots project and sources together, detached from both', () => {
    const p = project();
    const videos = sourceVideos();

    const snapshot = createUndoableSnapshot(p, videos);

    expect(snapshot.project).toEqual(p);
    expect(snapshot.sourceVideos).toEqual(videos);

    snapshot.project.timeline.clips[0].duration = 99;
    snapshot.sourceVideos[0].name = 'other.mp4';

    expect(p.timeline.clips[0].duration).toBe(5);
    expect(videos[0].name).toBe('v.mp4');
  });
});
