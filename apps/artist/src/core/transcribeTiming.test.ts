// ESCSUITE-486: a transcription's captions follow the timeline as it was when
// the run started, so the control warns when a clip's timing changed meanwhile.
import { describe, it, expect } from 'vitest';
import { soundTimingChanged } from './transcribeTiming';
import { makeClip, makeTextData } from '../test/fixtures/clipFixtures';

const speech = makeClip({ id: 'speech', timelinePosition: 2, duration: 10, endTime: 10 });
const music = makeClip({ id: 'music', trackId: 'track2', timelinePosition: 0, duration: 30, endTime: 30 });
const title = makeClip({ id: 'title', sourceVideoId: '', overlayType: 'text', textData: makeTextData(), timelinePosition: 1 });
const before = [speech, music, title];

describe('soundTimingChanged (ESCSUITE-486)', () => {
  it('is false for the same timeline, and for an equal copy of it', () => {
    expect(soundTimingChanged(before, before)).toBe(false);
    expect(soundTimingChanged(before, structuredClone(before))).toBe(false);
  });

  it('is true when a clip was moved along its track', () => {
    expect(soundTimingChanged(before, [{ ...speech, timelinePosition: 3 }, music, title])).toBe(true);
  });

  it('is true when a clip was trimmed, slipped or sped up', () => {
    expect(soundTimingChanged(before, [{ ...speech, duration: 8, endTime: 8 }, music, title])).toBe(true);
    expect(soundTimingChanged(before, [{ ...speech, startTime: 1, endTime: 11 }, music, title])).toBe(true);
    expect(soundTimingChanged(before, [{ ...speech, speed: 2 }, music, title])).toBe(true);
  });

  it('is true when a clip was put on another track', () => {
    expect(soundTimingChanged(before, [{ ...speech, trackId: 'track3' }, music, title])).toBe(true);
  });

  it('is true when a clip was removed, added or split', () => {
    expect(soundTimingChanged(before, [music, title])).toBe(true);
    expect(soundTimingChanged(before, [...before, makeClip({ id: 'more', timelinePosition: 40 })])).toBe(true);
    // A split: one clip becomes two.
    const left = { ...speech, duration: 4, endTime: 4 };
    const right = { ...speech, id: 'speech-b', timelinePosition: 6, startTime: 4, duration: 6 };
    expect(soundTimingChanged(before, [left, right, music, title])).toBe(true);
    // The same number of clips, one swapped for another.
    expect(soundTimingChanged(before, [{ ...speech, id: 'other' }, music, title])).toBe(true);
  });

  it('is false for edits that move no sound: a rename, a style, a title moved, added or removed', () => {
    expect(soundTimingChanged(before, [{ ...speech, name: 'Renamed', blendMode: 'multiply' }, music, title])).toBe(false);
    expect(soundTimingChanged(before, [speech, music, { ...title, timelinePosition: 9, duration: 1 }])).toBe(false);
    expect(soundTimingChanged(before, [speech, music])).toBe(false);
    expect(soundTimingChanged(before, [...before, { ...title, id: 'caption' }])).toBe(false);
  });

  it('reads a missing speed as 1, as playback does', () => {
    expect(soundTimingChanged(before, [{ ...speech, speed: 1 }, music, title])).toBe(false);
  });

  it('does not depend on clip order', () => {
    expect(soundTimingChanged(before, [title, music, speech])).toBe(false);
  });
});
