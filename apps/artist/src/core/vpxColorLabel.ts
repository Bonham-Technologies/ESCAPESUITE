import type { EncodedPacket } from 'mediabunny';
import { createVp9ColourSpaceStamper, relabelFirefoxVpxMeta } from '@escapesuite/shared/utils';

/**
 * The colour labels of one WebM export's video track, applied to each encoded
 * packet and its metadata on their way to the muxer: Firefox's report
 * corrected when `relabelFirefox` is set (`relabelFirefoxVpxMeta` in
 * `@escapesuite/shared/utils`, ESCSUITE-284; CRAFT's recorder applies the same
 * correction), then,
 * for VP9, every key frame header's `color_space` written from the (corrected)
 * report, as mediabunny's muxer did up to 1.65. A packet whose header changes
 * comes back as a copy; nothing the encoder handed over is written into.
 */
export function createWebMVideoLabeller(
  codec: 'vp8' | 'vp9',
  relabelFirefox: boolean
): (
  packet: EncodedPacket,
  meta: EncodedVideoChunkMetadata | undefined
) => { packet: EncodedPacket; meta: EncodedVideoChunkMetadata | undefined } {
  const stamp = codec === 'vp9' ? createVp9ColourSpaceStamper() : null;
  return (packet, meta) => {
    const labelled = relabelFirefox ? relabelFirefoxVpxMeta(meta) : meta;
    return { packet: stamp ? stamp(packet, labelled) : packet, meta: labelled };
  };
}
