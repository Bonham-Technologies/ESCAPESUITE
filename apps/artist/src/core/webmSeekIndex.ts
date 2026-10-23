// Seek index repair at import (ESCSUITE-305).
//
// Firefox will not seek a WebM that has no Cues index into a Cluster that does
// not start with a key frame: `seeked` never fires, `seeking` stays true and
// `readyState` stays at HAVE_METADATA for the life of the element. Chrome's
// MediaRecorder starts a Cluster about every second whatever the key frames
// are, and `webm-duration-fix` — which ESCAPECRAFT runs over every
// MediaRecorder take — records a cue only for a video *SimpleBlock*. Chrome
// writes every frame of the compositor's canvas stream as a *BlockGroup* (VP9
// with alpha carries BlockAdditions), so every composited-PiP take ESCAPECRAFT
// has ever stored has an empty Cues element (`1c53bb6b 80`), and ESCAPEARTIST
// on Firefox exported each one as a black picture.
//
// The cure measured on the real take is an index: the same bytes with a real
// Cues element seek 48/48 on Firefox. Mediabunny's muxer writes one CuePoint
// per Cluster and starts a Cluster at key frames, so a packet copy through it —
// no decoder, no encoder — produces exactly that. It runs once, at import, and
// only for a WebM whose index is missing or empty: one header read decides, and
// a file that already has an index (every Mediabunny-written file, every
// ESCAPECRAFT WebCodecs take) is never rewritten.
import {
  BlobSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  StreamTarget,
  WEBM,
  WebMOutputFormat,
  type AudioCodec,
  type EncodedPacket,
  type InputAudioTrack,
  type InputTrack,
  type VideoCodec,
} from 'mediabunny';
import { createChunkCollector } from './chunkCollector';
import {
  CLUSTER_ID,
  CUES_ID,
  EBML_ID,
  HEAD_BYTES,
  SEEK_HEAD_ID,
  SEGMENT_ID,
  cuesPositionIn,
  dropDeltaFrameCues,
  isWebmType,
  readHeader,
} from './webmDeltaFrameCues';

export { isWebmType };

/**
 * Whether this WebM has no usable seek index: its Cues element is empty, or it
 * has none and its media begins. False for anything that is not a WebM this can
 * read — junk, a truncated header, a layout whose first Cluster lies past the
 * bytes the probe reads — because a file that cannot be read cannot be repaired
 * either, and leaving it alone is what happened before.
 */
export async function needsSeekIndexRepair(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const ebml = readHeader(head, 0);
  if (ebml?.id !== EBML_ID) return false;
  const segment = readHeader(head, ebml.dataStart + ebml.size);
  if (segment?.id !== SEGMENT_ID) return false;

  for (let pos = segment.dataStart; ; ) {
    const element = readHeader(head, pos);
    if (!element) return false;
    if (element.id === CUES_ID) return element.size === 0;
    if (element.id === CLUSTER_ID) return true;
    if (element.id === SEEK_HEAD_ID) {
      const cuesPosition = cuesPositionIn(head, element);
      if (cuesPosition !== null) {
        const at = segment.dataStart + cuesPosition;
        const cues = readHeader(new Uint8Array(await blob.slice(at, at + 12).arrayBuffer()), 0);
        return cues?.id !== CUES_ID || cues.size === 0;
      }
    }
    pos = element.dataStart + element.size;
  }
}

/** Every packet of one track, in order, into its output source, then close it. */
async function copyPackets(
  track: InputTrack,
  add: (packet: EncodedPacket) => Promise<void>,
  close: () => void
): Promise<void> {
  for await (const packet of new EncodedPacketSink(track).packets()) await add(packet);
  close();
}

/**
 * The same packets in a new WebM with a Cues index: every track's encoded
 * packets — timestamps, key flags, bytes and side data (a VP9 alpha plane
 * among them) — copied through Mediabunny's muxer with no decoder and no
 * encoder. The result keeps the original's MIME type, and carries no video
 * cue on a Cluster that starts with a delta frame (`dropDeltaFrameCues`,
 * ESCSUITE-359).
 *
 * Throws on anything it cannot copy — a track with a codec Mediabunny cannot
 * name, a track that is neither video nor audio (its audio source refuses the
 * codec) — and the caller keeps the original bytes.
 */
export async function remuxWithSeekIndex(blob: Blob): Promise<Blob> {
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] });
  try {
    const collector = createChunkCollector();
    const output = new Output({ format: new WebMOutputFormat(), target: new StreamTarget(collector.writable) });
    const pumps: Array<() => Promise<void>> = [];

    for (const track of await input.getTracks()) {
      // A codec Mediabunny cannot name is null, and both sources refuse it.
      if (track.isVideoTrack()) {
        const source = new EncodedVideoPacketSource(track.codec as VideoCodec);
        // Declared up front rather than left to the first packet, so an alpha
        // track whose first frame happens to carry no alpha plane keeps AlphaMode.
        output.addVideoTrack(source, { canBeTransparent: await track.canBeTransparent() });
        const meta = { decoderConfig: (await track.getDecoderConfig()) as VideoDecoderConfig };
        pumps.push(() => copyPackets(track, (packet) => source.add(packet, meta), () => source.close()));
      } else {
        // Anything that is not video is copied as audio: a subtitle track's
        // codec is not an audio codec, so its source refuses it and the remux
        // throws, which keeps the original.
        const audio = track as InputAudioTrack;
        const source = new EncodedAudioPacketSource(audio.codec as AudioCodec);
        output.addAudioTrack(source);
        const meta = { decoderConfig: (await audio.getDecoderConfig()) as AudioDecoderConfig };
        pumps.push(() => copyPackets(audio, (packet) => source.add(packet, meta), () => source.close()));
      }
    }

    await output.start();
    await Promise.all(pumps.map((pump) => pump()));
    await output.finalize();
    const remuxed = collector.toBlob(blob.type);
    return (await dropDeltaFrameCues(remuxed)) ?? remuxed;
  } finally {
    input.dispose();
  }
}

/**
 * The bytes to store for an imported file: a WebM with no usable seek index
 * remuxed with one, a WebM whose index points video at delta frames with those
 * cues dropped, anything else exactly as it came. A probe or a remux that
 * throws leaves the original and says so once — the import goes on, and a
 * browser that can seek the file (Chromium) is no worse off than before.
 */
export async function withSeekIndex(blob: Blob, name: string): Promise<Blob> {
  try {
    // Inside the try: a record with no bytes at all is kept as it came, for the
    // caller's own checks to decide about, rather than thrown on here.
    if (!isWebmType(blob.type)) return blob;
    if (await needsSeekIndexRepair(blob)) return await remuxWithSeekIndex(blob);
    // An index this module wrote before ESCSUITE-359 can carry cues on delta
    // frames; a take re-imported from ESCAPECRAFT's row is repaired here too.
    return (await dropDeltaFrameCues(blob)) ?? blob;
  } catch (error) {
    console.warn(`Could not add a seek index to "${name}"; keeping it as recorded:`, error);
    return blob;
  }
}
