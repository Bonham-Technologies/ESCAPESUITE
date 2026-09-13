// clipEditorModel on its own: no component, no store.
//
// Each case is written from the inputs the panel would actually see —
// a clip's overlayType, a source video's mediaType, the playhead relative to
// a clip's position — rather than copied off a render.
import { describe, it, expect } from 'vitest';
import {
  describeClip,
  relativeTimeInClip,
  overlayPositionValue,
  maxPresetDuration,
  fitToCanvasScale,
  keyframeCount,
} from './clipEditorModel';
import {
  makeAnimation,
  makeClip,
  makeShapeData,
  makeSourceVideo,
  makeTextData,
} from '../../test/fixtures/exportPipeline';

describe('describeClip', () => {
  it('labels a plain video clip with no overlay type and no special source', () => {
    const clip = makeClip();
    const result = describeClip(clip, makeSourceVideo());
    expect(result).toEqual({
      isTextOverlay: false,
      isShapeOverlay: false,
      isOverlay: false,
      isImage: false,
      isAudio: false,
      isVideo: true,
      clipTypeLabel: 'Video Clip',
    });
  });

  it('labels a text overlay clip, taking precedence over everything else', () => {
    const clip = makeClip({ overlayType: 'text', textData: makeTextData() });
    const result = describeClip(clip, makeSourceVideo({ mediaType: 'image' }));
    expect(result.isTextOverlay).toBe(true);
    expect(result.isOverlay).toBe(true);
    expect(result.isVideo).toBe(false);
    expect(result.clipTypeLabel).toBe('Text Overlay');
  });

  it('labels a shape overlay clip, taking precedence over image/audio', () => {
    const clip = makeClip({ overlayType: 'shape', shapeData: makeShapeData() });
    const result = describeClip(clip, makeSourceVideo({ mediaType: 'audio' }));
    expect(result.isShapeOverlay).toBe(true);
    expect(result.isOverlay).toBe(true);
    expect(result.isVideo).toBe(false);
    expect(result.clipTypeLabel).toBe('Shape Overlay');
  });

  it('labels an image clip', () => {
    const clip = makeClip();
    const result = describeClip(clip, makeSourceVideo({ mediaType: 'image' }));
    expect(result.isImage).toBe(true);
    expect(result.isVideo).toBe(false);
    expect(result.clipTypeLabel).toBe('Image');
  });

  it('labels an audio clip', () => {
    const clip = makeClip();
    const result = describeClip(clip, makeSourceVideo({ mediaType: 'audio' }));
    expect(result.isAudio).toBe(true);
    expect(result.isVideo).toBe(false);
    expect(result.clipTypeLabel).toBe('Audio');
  });

  it('falls back to Video Clip with no clip selected and no source video', () => {
    const result = describeClip(null, null);
    expect(result).toEqual({
      isTextOverlay: false,
      isShapeOverlay: false,
      isOverlay: false,
      isImage: false,
      isAudio: false,
      isVideo: true,
      clipTypeLabel: 'Video Clip',
    });
  });

  it('treats undefined clip and source video the same as null', () => {
    const result = describeClip(undefined, undefined);
    expect(result.isVideo).toBe(true);
    expect(result.clipTypeLabel).toBe('Video Clip');
  });
});

describe('relativeTimeInClip', () => {
  it('returns the time relative to the clip start when inside the clip', () => {
    expect(relativeTimeInClip(12, 10, 5)).toBe(2);
  });

  it('returns 0 exactly at the clip start (inclusive lower bound)', () => {
    expect(relativeTimeInClip(10, 10, 5)).toBe(0);
  });

  it('returns null just before the clip starts', () => {
    expect(relativeTimeInClip(9.999, 10, 5)).toBeNull();
  });

  it('returns null exactly at the clip end (exclusive upper bound)', () => {
    expect(relativeTimeInClip(15, 10, 5)).toBeNull();
  });

  it('returns the time just before the clip end', () => {
    expect(relativeTimeInClip(14.999, 10, 5)).toBeCloseTo(4.999);
  });

  it('returns null well outside the clip', () => {
    expect(relativeTimeInClip(0, 10, 5)).toBeNull();
  });
});

describe('overlayPositionValue', () => {
  it('reads the text overlay x when the clip is a text overlay', () => {
    const clip = makeClip({ overlayType: 'text', textData: makeTextData({ x: 0.25, y: 0.75 }) });
    expect(overlayPositionValue(clip, 'x', true)).toBe(0.25);
    expect(overlayPositionValue(clip, 'y', true)).toBe(0.75);
  });

  it('reads the shape overlay position when the clip is a shape overlay', () => {
    const clip = makeClip({ overlayType: 'shape', shapeData: makeShapeData({ x: 0.1, y: 0.9 }) });
    expect(overlayPositionValue(clip, 'x', true)).toBe(0.1);
    expect(overlayPositionValue(clip, 'y', true)).toBe(0.9);
  });

  it('falls back to the clip transform when isOverlay is false, even with textData present', () => {
    const clip = makeClip({
      overlayType: 'text',
      textData: makeTextData({ x: 0.25 }),
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    expect(overlayPositionValue(clip, 'x', false)).toBe(0.5);
  });

  it('falls back to the clip transform for a media clip with no overlay data', () => {
    const clip = makeClip({
      transform: { x: 0.3, y: 0.6, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    expect(overlayPositionValue(clip, 'x', false)).toBe(0.3);
    expect(overlayPositionValue(clip, 'y', false)).toBe(0.6);
  });
});

describe('maxPresetDuration', () => {
  it('caps at 2 seconds for a long clip', () => {
    expect(maxPresetDuration(10)).toBe(2);
  });

  it('is half the clip duration for a short clip', () => {
    expect(maxPresetDuration(3)).toBe(1.5);
  });

  it('is exactly 1 at the d=2 boundary between the two branches', () => {
    expect(maxPresetDuration(2)).toBe(1);
  });

  it('can go below the slider minimum for a very short clip (d < 0.2)', () => {
    expect(maxPresetDuration(0.1)).toBeCloseTo(0.05);
  });
});

describe('fitToCanvasScale', () => {
  it('picks the narrower of the two axis ratios (width-constrained)', () => {
    const scale = fitToCanvasScale({ width: 1000, height: 1000 }, { width: 500, height: 200 });
    // width ratio: 2, height ratio: 5 -> min is 2
    expect(scale).toBe(2);
  });

  it('picks the narrower of the two axis ratios (height-constrained)', () => {
    const scale = fitToCanvasScale({ width: 1000, height: 200 }, { width: 500, height: 500 });
    // width ratio: 2, height ratio: 0.4 -> min is 0.4
    expect(scale).toBe(0.4);
  });
});

describe('keyframeCount', () => {
  it('is 0 for undefined animation', () => {
    expect(keyframeCount(undefined)).toBe(0);
  });

  it('is 0 for an animation with no keyframes at all', () => {
    expect(keyframeCount(makeAnimation())).toBe(0);
  });

  it('sums keyframe counts across every animated property', () => {
    const animation = makeAnimation({
      keyframes: {
        x: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 1, easing: 'linear' },
        ],
        opacity: [{ time: 0, value: 1, easing: 'linear' }],
      },
    });
    expect(keyframeCount(animation)).toBe(3);
  });

  it('treats an empty keyframe array as zero via the length-or-zero fallback', () => {
    const animation = makeAnimation({ keyframes: { x: [] } });
    expect(keyframeCount(animation)).toBe(0);
  });

  it('treats an explicitly undefined keyframes entry as zero via optional chaining', () => {
    const animation = makeAnimation({ keyframes: { x: undefined } });
    expect(keyframeCount(animation)).toBe(0);
  });
});
