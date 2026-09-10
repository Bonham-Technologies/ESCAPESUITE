// Shared fixtures for the export-pipeline test files (audio mixer, canvas
// renderer, MP4/WebM exporters).
//
// Lives under src/test/ so neither the vitest `include` glob (which would treat
// it as a suite containing no tests) nor the coverage `include` glob (which
// would score test scaffolding as production code) picks it up.
import type {
  Clip,
  ClipAnimation,
  ExportOptions,
  ShapeOverlayData,
  SourceVideo,
  TextOverlayData,
  Track,
} from '../../store/types'
import type { AnimatedOverlayValues } from '../../core/exportTypes'

export function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track1',
    name: 'Track 1',
    index: 0,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
    ...overrides,
  }
}

export function makeClip(overrides: Partial<Clip> = {}): Clip {
  const duration = overrides.duration ?? 5
  return {
    id: 'clip1',
    sourceVideoId: 'video1',
    name: 'Clip 1',
    trackId: 'track1',
    startTime: 0,
    endTime: duration,
    duration,
    timelinePosition: 0,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0 },
    ...overrides,
  }
}

/** A clip animation with no presets — the base for keyframe-only fixtures. */
export function makeAnimation(overrides: Partial<ClipAnimation> = {}): ClipAnimation {
  return {
    in: { type: 'none', duration: 0, easing: 'linear' },
    out: { type: 'none', duration: 0, easing: 'linear' },
    keyframes: {},
    ...overrides,
  }
}

export function makeSourceVideo(overrides: Partial<SourceVideo> = {}): SourceVideo {
  return {
    id: 'video1',
    name: 'test.mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/mp4',
    size: 1000,
    ...overrides,
  }
}

export function makeExportOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    format: 'mp4',
    quality: 'medium',
    resolution: 'original',
    ...overrides,
  }
}

export function makeTextData(overrides: Partial<TextOverlayData> = {}): TextOverlayData {
  return {
    text: 'Hello',
    x: 0.5,
    y: 0.5,
    fontFamily: 'Arial',
    fontSize: 40,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#ffffff',
    backgroundColor: '#00000000',
    textAlign: 'center',
    ...overrides,
  }
}

export function makeShapeData(overrides: Partial<ShapeOverlayData> = {}): ShapeOverlayData {
  return {
    type: 'rectangle',
    x: 0.5,
    y: 0.5,
    width: 0.25,
    height: 0.5,
    fillColor: '#ff0000ff',
    strokeColor: '#0000ffff',
    strokeWidth: 4,
    rotation: 0,
    ...overrides,
  }
}

export function makeAnimated(
  overrides: Partial<AnimatedOverlayValues> = {}
): AnimatedOverlayValues {
  return {
    x: 0.5,
    y: 0.5,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blur: 0,
    ...overrides,
  }
}
