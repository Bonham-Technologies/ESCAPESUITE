// apps/artist/src/headless/audioTrackProbe.ts
import { ALL_FORMATS, BlobSource, BufferSource, Input } from 'mediabunny'
import type { SourceVideo } from '../store/types'

/**
 * Whether a source's container carries an audio track (ESCSUITE-312), read from its headers by
 * mediabunny's demuxer — the `moov` of an MP4, the tracks of a Matroska/WebM, a WAV's `fmt `
 * chunk — and **never decoded**. That costs milliseconds and no memory per source, where
 * `decodeAudioData` over a ten-minute source would cost a full decode and some 230 MB.
 *
 * Throws when no demuxer recognises the bytes; {@link anySourceCarriesAudio} decides what that
 * means. Lives in `headless/` rather than beside `projectHasAudio` in core because only the
 * headless entry asks: the editor's dialog can show a note instead, and both exporters decode
 * the mix anyway.
 */
export async function containerHasAudioTrack(bytes: ArrayBuffer | Blob): Promise<boolean> {
  const input = new Input({
    source: bytes instanceof Blob ? new BlobSource(bytes) : new BufferSource(bytes),
    formats: ALL_FORMATS,
  })
  try {
    return (await input.getPrimaryAudioTrack()) !== null
  } finally {
    input.dispose()
  }
}

/**
 * Whether any of these sources — `audioCandidateSources`' list, each once — carries sound, for
 * the headless no-AAC mp4 refusal. An audio source counts without a probe, and is looked for
 * first so a project holding one reads no headers at all; then each other source's container is
 * probed in turn, stopping at the first with an audio track. A source whose container cannot be
 * read counts as sounded — the conservative answer, since the alternative is a silent file —
 * with one warning naming it.
 *
 * `probe` is a parameter so the caller names the one it means and a test can count it.
 */
export async function anySourceCarriesAudio(
  sources: SourceVideo[],
  sourceBlobs: Record<string, ArrayBuffer | Blob>,
  probe: (bytes: ArrayBuffer | Blob) => Promise<boolean>,
): Promise<boolean> {
  if (sources.some((source) => source.mediaType === 'audio')) return true
  for (const source of sources) {
    try {
      if (await probe(sourceBlobs[source.id])) return true
    } catch (err) {
      console.warn(
        `[headless] Could not read the container of source "${source.name}" to tell whether it has an audio track; treating it as sounded`,
        err,
      )
      return true
    }
  }
  return false
}
