/**
 * The `VideoDecoderConfig` the decode worker gives a demuxed track, and the
 * checks that refuse a track the worker would not draw the way `<video>` does.
 *
 * Kept apart from `decodeWorker.ts` (which only runs inside a Web Worker) so
 * these decisions run under vitest. Every choice here was measured against
 * Chromium 153's own `<video>` element, drawing a frame of each path onto a
 * canvas side by side (ESCSUITE-254); the `<video>` path is the oracle, since
 * it is what every MP4 export used before the worker decoded anything.
 */

import type { DemuxedVideo } from './mp4Demux';

/** `VideoDecoderConfig` plus the orientation members Chromium implements and TypeScript's DOM lib does not carry yet. */
export type OrientedDecoderConfig = VideoDecoderConfig & { rotation?: number; flip?: boolean };

export type ConfigSupportCheck = (config: OrientedDecoderConfig) => Promise<{
  supported?: boolean;
  config?: OrientedDecoderConfig;
}>;

/**
 * The colour space Chromium's media pipeline assumes for a stream that does
 * not fully describe its own: BT.601 below 720 lines, BT.709 from 720 up
 * (measured: 718 lines is 601, 720 is 709; the width plays no part). A raw
 * VideoDecoder assumes BT.709 at every size instead, which shifts a
 * saturated colour by up to ~20/255 against the preview and against the
 * `<video>` path.
 *
 * Measured in Chromium 153, `<video>` beside a VideoDecoder given no colour
 * space, the guess, and BT.709 (ESCSUITE-254 fix rounds 1 and 2), one shape
 * at a time:
 * - untagged (no colour description anywhere), nine sizes from 160x120 to
 *   1920x544 and 1280x720 (718 lines is 601, 720 is 709):
 *   `<video>` draws the size guess; the decoder draws whatever it is given.
 * - VUI tagging only the matrix (BT.709; primaries and transfer
 *   unspecified), 160x120: `<video>` draws BT.601, the guess — not the tag.
 * - VUI tagging primaries, transfer and matrix as BT.709, 640x480 (and a
 *   160x120 BT.709 and a 1280x720 BT.601 file): both draw the stream's own
 *   colours whatever colour space the decoder is given.
 * - VUI signalling full range and no colour description, 640x480: both draw
 *   the same whatever the decoder is given.
 * - `colr` box alone (6/6/6 or 1/1/1 over an untagged VUI): `<video>` follows
 *   the box — BT.601 at 1280x720, where the guess says BT.709, and BT.709 at
 *   160x120, where it says BT.601 — and the decoder, which cannot see the
 *   box, draws what it is given.
 * - `colr` box disagreeing with a fully tagged VUI: `<video>` draws the VUI's.
 * Firefox 155's VideoDecoder ignores the config, its `<video>` ignores the
 * `colr` box, and the two matched in every shape.
 *
 * Hence (mp4Demux.ts's `StreamColour`): no colour space for a fully tagged
 * bitstream; the box's own values for a `colr`-only description; the guess,
 * with the stream's own range, for anything else; and a `colr` box that
 * disagrees with any colour description in the bitstream is refused rather
 * than one of the two picked.
 */
export function assumedColorSpace(codedHeight: number): VideoColorSpaceInit {
  const standard = codedHeight >= 720 ? 'bt709' : 'smpte170m';
  return { primaries: standard, transfer: standard, matrix: standard, fullRange: false };
}

/**
 * Build the decoder configuration for `video` and check it against the
 * browser. Throws a named error — so the source falls back to `<video>` —
 * when:
 *
 * - the browser cannot decode it.
 * - the track is rotated and the browser's VideoDecoder does not apply
 *   `rotation` to its output. A browser that implements the member echoes it
 *   back from isConfigSupported; one that does not drops it, and would hand
 *   back frames lying on their side. The echo proves the member is known, not
 *   that `drawImage` honours `VideoFrame.rotation` — that was measured, in
 *   Chromium — so it is enough only behind `core/workerDecodeEngine.ts`'s
 *   allow-list, never as the only guard in an unmeasured engine.
 */
export async function decoderConfigFor(
  video: DemuxedVideo,
  isConfigSupported: ConfigSupportCheck
): Promise<OrientedDecoderConfig> {
  const config: OrientedDecoderConfig = {
    codec: video.codec,
    codedWidth: video.codedWidth,
    codedHeight: video.codedHeight,
    description: video.description,
    // 'prefer-hardware' is a requirement in Chromium, not a preference: a
    // machine without a hardware decoder for the codec (a Linux CI runner, a
    // VM) would refuse every source.
    hardwareAcceleration: 'no-preference',
  };
  // A fully tagged bitstream keeps its own colours (no colorSpace); a colour
  // description only the colr box carries is handed over, since the decoder
  // cannot see the box; otherwise the guess <video> makes.
  if (video.colour.kind === 'container') {
    config.colorSpace = video.colour.colorSpace;
  } else if (video.colour.kind === 'unspecified') {
    config.colorSpace = { ...assumedColorSpace(video.codedHeight), fullRange: video.colour.fullRange ?? false };
  }
  if (video.rotation !== 0) config.rotation = video.rotation;

  const support = await isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`Codec not supported: ${config.codec}`);
  }
  if (video.rotation !== 0 && support.config?.rotation !== video.rotation) {
    throw new Error(
      `This browser's VideoDecoder cannot rotate its output; the source's ${video.rotation}° display rotation needs the <video> path`
    );
  }
  return config;
}
