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
 * `<video>` path. A stream that does carry primaries, transfer and matrix
 * keeps them in both paths: the config's colour space only fills in what the
 * bitstream leaves out.
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
 * - the codec is not H.264. It is the only codec the worker's output was
 *   compared against `<video>`'s; HEVC, VP9 and AV1 in MP4 keep the path they
 *   always had.
 * - the browser cannot decode it.
 * - the track is rotated and the browser's VideoDecoder does not apply
 *   `rotation` to its output. A browser that implements the member echoes it
 *   back from isConfigSupported; one that does not drops it, and would hand
 *   back frames lying on their side.
 */
export async function decoderConfigFor(
  video: DemuxedVideo,
  isConfigSupported: ConfigSupportCheck,
  preferHardwareAcceleration: boolean
): Promise<OrientedDecoderConfig> {
  if (!/^avc[13]\./.test(video.codec)) {
    throw new Error(`Only H.264 is decoded in the worker; ${video.codec} needs the <video> path`);
  }
  const config: OrientedDecoderConfig = {
    codec: video.codec,
    codedWidth: video.codedWidth,
    codedHeight: video.codedHeight,
    description: video.description,
    colorSpace: assumedColorSpace(video.codedHeight),
    // 'prefer-hardware' is a requirement in Chromium, not a preference: a
    // machine without a hardware decoder for the codec (a Linux CI runner, a
    // VM) would refuse every source.
    hardwareAcceleration: preferHardwareAcceleration ? 'prefer-hardware' : 'no-preference',
  };
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
