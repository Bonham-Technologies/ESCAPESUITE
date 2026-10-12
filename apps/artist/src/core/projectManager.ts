// Project save/load functionality

import type { Project, SourceVideo, Clip, EditorBlock } from '../store/types';
import {
  deleteVideo,
  getStorageEstimate,
  getVideo,
  storeVideo,
  storeThumbnail,
  getThumbnail,
  resolveThumbnailUrl,
} from './storage';
import { loadMediaDuration, resolveStoredDuration } from './videoProcessor';
import {
  ProjectFileError,
  assertRangesTile,
  encodeProjectFile,
  formatSize,
  readProjectFileIndex,
  sliceRange,
  type ProjectFileIndex,
  type ProjectFileSource,
} from './projectFileFormat';

/**
 * The `SourceVideo` fields a saved project persists alongside each video's
 * bytes — everything `extractMetadataFromBlob` cannot recover from the blob
 * alone (ESCSUITE-97): waveform peaks, take identity, and the flags a
 * consumer like `TimelineTrack` reads without re-deriving them. `id`/`name`/
 * `mimeType` are not repeated here — the file already carries them at the top
 * level of each `videos[i]` entry — and `size`/`thumbnailUrl` are excluded
 * because they are restored values, never trusted from the file: `size` is
 * always the restored blob's own `size`, and `thumbnailUrl` is always
 * rebuilt through `resolveThumbnailUrl` (ESCSUITE-96) or left unset, never
 * read from a saved string (review round 1: a `meta` object built by hand
 * could otherwise carry a stale or spoofed `blob:` handle straight through).
 * `Omit` rather than a hand-copied field list, so a future required
 * `SourceVideo` field fails to compile at the `meta` literal in `saveProject`
 * instead of silently never being persisted.
 *
 * Every field left is optional so an old save (or a video whose live
 * metadata never set one) still round-trips: `undefined` values are dropped
 * by `JSON.stringify` rather than written as `null`.
 */
export type SourceVideoMeta = Omit<SourceVideo, 'id' | 'name' | 'mimeType' | 'size' | 'thumbnailUrl'>;

/**
 * A v1 `.veditor`: one JSON document with every source base64-encoded inside
 * it. Only read now: `saveProject` writes the v2 container
 * (`projectFileFormat.ts`, ESCSUITE-260), and `loadProject` still opens every
 * v1 file an older build wrote.
 */
export interface ProjectFile {
  version: number;
  project: Project;
  /**
   * The in/out points and markers (ESCSUITE-245). Beside `project`, not inside
   * it. Additive: absent on a file saved before the ticket, which loads with
   * no range and no markers. Validated by `parseProject` on the way in.
   */
  editor?: EditorBlock;
  videos: {
    id: string;
    name: string;
    mimeType: string;
    data: string; // Base64 encoded video data
    thumbnail?: string; // Base64 encoded thumbnail
    /**
     * The live `SourceVideo`'s own fields, written on save (ESCSUITE-97).
     * Additive: absent on a file saved before this ticket, or one written by
     * an older ESCAPEARTIST build, and `loadProject` falls back to
     * `extractMetadataFromBlob` exactly as it always has when it is missing.
     */
    meta?: SourceVideoMeta;
  }[];
}

/**
 * The version a v1 (JSON) `.veditor` declares. The writer produces v2
 * (`projectFileFormat.ts`); this is what the v1 loader accepts and what
 * `exportProjectMetadata`'s metadata-only JSON still says.
 */
const JSON_FILE_VERSION = 1;

/**
 * Convert base64 string to Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Save the project and the sources its timeline uses as a v2 `.veditor`
 * (ESCSUITE-260). The stored blobs are IndexedDB handles: they go into the
 * file by reference, so no source byte is read, and the only bytes built here
 * are the header and the index. There is no size budget. The file is limited
 * by the browser's download size, not by the format.
 */
export async function saveProject(
  project: Project,
  sourceVideos: SourceVideo[],
  onProgress?: (progress: number, message: string) => void,
  /** Handed in, as `sourceVideos` is, rather than read from the store here. */
  editor?: EditorBlock
): Promise<void> {
  onProgress?.(0, 'Preparing project data...');

  // Get all videos used in the timeline
  const usedVideoIds = new Set(project.timeline.clips.map((c) => c.sourceVideoId));
  const usedVideos = sourceVideos.filter((v) => usedVideoIds.has(v.id));

  const sources: ProjectFileSource[] = [];
  for (const video of usedVideos) {
    const videoData = await getVideo(video.id);
    if (!videoData) continue;
    const thumbnail = await getThumbnail(video.id);

    const meta: SourceVideoMeta = {
      duration: video.duration,
      width: video.width,
      height: video.height,
      frameRate: video.frameRate,
      frameRateSource: video.frameRateSource,
      mediaType: video.mediaType,
      source: video.source,
      recordedAt: video.recordedAt,
      waveformData: video.waveformData,
      hasAudio: video.hasAudio,
      takeId: video.takeId,
      role: video.role,
      startOffset: video.startOffset,
      overlayPlacement: video.overlayPlacement,
      hasWebcam: video.hasWebcam,
    };

    sources.push({
      id: video.id,
      name: video.name,
      mimeType: video.mimeType,
      meta,
      blob: videoData.blob,
      thumbnail,
    });
  }

  onProgress?.(90, 'Creating project file...');

  const blob = new Blob(encodeProjectFile(project, editor, sources), { type: 'application/octet-stream' });

  // Download file
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name || 'project'}.veditor`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  onProgress?.(100, 'Project saved!');
}

/**
 * A width or height a saved `meta` can be trusted for: a real, non-negative
 * finite number. Zero is valid — it is how an audio-only `SourceVideo` has
 * always recorded "no picture" (`extractAudioMetadata`) — so this only
 * catches what `JSON.parse` lets through that a live `SourceVideo` never
 * would: `null`, `NaN`, a negative number, or `Infinity` (review round 1).
 */
function isUsableDimension(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Width/height from a saved `meta`, recovered from the blob when either is
 * not a usable number — the same "trust it unless it's broken" treatment
 * `resolveStoredDuration` gives `duration`. There is no dedicated probe for
 * dimensions alone, so recovery reuses the full blob probe and keeps only
 * the two fields that needed it.
 */
async function resolveMetaDimensions(
  blob: Blob,
  meta: SourceVideoMeta,
  savedData: { id: string; name: string; mimeType: string }
): Promise<{ width: number; height: number }> {
  if (isUsableDimension(meta.width) && isUsableDimension(meta.height)) {
    return { width: meta.width, height: meta.height };
  }
  const probed = await extractMetadataFromBlob(blob, savedData);
  return { width: probed.width, height: probed.height };
}

/** What either file version says about one source, beside its bytes. */
interface SourceEntry {
  id: string;
  name: string;
  mimeType: string;
  meta?: SourceVideoMeta;
}

/** The row already in the shared DB under a source's id, if there is one. */
type StoredSource = Awaited<ReturnType<typeof getVideo>>;

/** A file's contents once its sources are restored, before `loadProject` stamps `modified`. */
interface LoadedFile {
  project: Project;
  editor?: unknown;
  sourceVideos: SourceVideo[];
}

/**
 * Restore one source from either file version (ESCSUITE-260): `blob` is the
 * source's bytes, decoded from v1 base64 or sliced out of a v2 payload, and
 * `thumbnail` likewise. One helper for both versions, so the metadata
 * recovery and the identity rules below cannot drift between them.
 *
 * `existing` is the row already stored under this id, looked up by the
 * caller. A `.veditor` load restores the bytes ARTIST needs; it is not
 * authority over metadata it does not own (ESCSUITE-151). It decides two
 * things below: which five fields describe CRAFT's take identity, and whether
 * this source's bytes and thumbnail are written to the DB at all.
 */
async function restoreSource(
  entry: SourceEntry,
  blob: Blob,
  thumbnail: Blob | undefined,
  existing: StoredSource,
  /** Every id this load has stored so far; `restoreSources` deletes them if the load fails. */
  written: string[]
): Promise<SourceVideo> {
  // A file saved since ESCSUITE-97 carries the live SourceVideo's own
  // fields in `meta`: waveform peaks, take identity, the real frame rate.
  // Those are trusted in preference to a blob probe. But `meta` came out of
  // `JSON.parse`, not the type checker: a hand-edited or corrupted file can
  // still carry a `duration`/`width`/`height` that is not a usable number
  // (review round 1), so each is validated and, only when it fails, recovered
  // from the blob rather than stored unquestioned. The common case, a `meta`
  // written by this same `saveProject`, never touches the blob at all. This
  // runs the same way whether or not `existing` is set: a present source's
  // own duration, dimensions and waveform are still worth restoring from the
  // file being reopened. Review round 1 tried reusing `existing.metadata`
  // wholesale instead, which silently dropped a reopened CRAFT take's
  // waveform (CRAFT never computes one) and let a stored non-finite duration
  // bypass this same recovery.
  //
  // An older file has no `meta` at all. If this id is already in the shared
  // DB, the stored record is still strictly more than a blob probe can ever
  // recover (waveform peaks, `hasAudio`, `recordedAt`), so it is trusted over
  // re-probing (review round 2). "Trusted" still means run through the same
  // `resolveStoredDuration`/`resolveMetaDimensions` recovery the `meta`
  // branch uses, not copied unquestioned: the stored record can itself carry
  // a `duration: Infinity` or an unusable dimension (review round 3). Only a
  // source this DB has never heard of falls back to reconstructing
  // everything from the blob, through `extractMetadataFromBlob`.
  let metadata: SourceVideo;
  if (entry.meta) {
    const duration = await resolveStoredDuration(blob, {
      ...entry.meta,
      name: entry.name,
    } as SourceVideo);
    const { width, height } = await resolveMetaDimensions(blob, entry.meta, entry);
    metadata = {
      ...entry.meta,
      id: entry.id,
      name: entry.name,
      mimeType: entry.mimeType,
      size: blob.size,
      duration,
      width,
      height,
    };
  } else if (existing) {
    const duration = await resolveStoredDuration(blob, existing.metadata);
    const { width, height } = await resolveMetaDimensions(blob, existing.metadata, existing.metadata);
    metadata = { ...existing.metadata, duration, width, height };
  } else {
    metadata = await extractMetadataFromBlob(blob, entry);
  }

  // A stored thumbnail (below) is the only legitimate source of a live
  // `thumbnailUrl`, never a value that arrived in the file itself. `meta` is
  // typed to exclude `thumbnailUrl`, but nothing stops a hand-edited file
  // from smuggling one in through the spread above, and it must not reach
  // IndexedDB via `storeVideo` (ESCSUITE-96 is exactly the failure a stale
  // `blob:` handle in storage causes) or survive into the returned
  // `SourceVideo` when the file has no real thumbnail (review round 1).
  delete metadata.thumbnailUrl;

  if (existing) {
    // CRAFT's take identity belongs to whatever is already stored under this
    // id, never to the file: these five fields are the only ones
    // `source: 'recording'` means anything for (apps/craft/src/core/storage.ts),
    // and a `.veditor` carrying an identical-looking `meta` must not be able
    // to assert them over what CRAFT, or an earlier load, actually wrote
    // (ESCSUITE-151).
    metadata.source = existing.metadata.source;
    metadata.takeId = existing.metadata.takeId;
    metadata.role = existing.metadata.role;
    metadata.startOffset = existing.metadata.startOffset;
    metadata.overlayPlacement = existing.metadata.overlayPlacement;
    // A `blob:` handle never survives a reload on its own (ESCSUITE-96), so
    // it is refreshed from what is actually stored. The file's own thumbnail
    // is not written for an id already present.
    metadata.thumbnailUrl = await resolveThumbnailUrl(entry.id);
  } else {
    // Not in the shared DB, so restoring it resurrects a copy under an
    // identity CRAFT no longer recognises as live. `source: 'recording'`
    // would put a take the user deleted in CRAFT back into CRAFT's library,
    // and `takeId`/`role`/`startOffset`/`overlayPlacement` describe a take
    // group this copy is not part of (ESCSUITE-151). Cleared outright, not
    // set to `'import'`: ARTIST's own importers never write a `source`.
    delete metadata.source;
    delete metadata.takeId;
    delete metadata.role;
    delete metadata.startOffset;
    delete metadata.overlayPlacement;

    await storeVideo(entry.id, blob, metadata);
    // Recorded as soon as the row exists, so a thumbnail write that fails
    // next still rolls this video back.
    written.push(entry.id);
    if (thumbnail) {
      await storeThumbnail(entry.id, thumbnail);
      metadata.thumbnailUrl = await resolveThumbnailUrl(entry.id);
    }
  }

  return metadata;
}

/**
 * Delete every source this load stored, best-effort, each on its own: one that
 * cannot be deleted is warned about and left. It is unreferenced, and
 * ESCSUITE-268's "files from earlier sessions" list offers it for removal.
 * Only ids this call stored are ever here, so a source that was present before
 * the load is never touched.
 */
async function rollBack(written: string[]): Promise<void> {
  for (const id of written) {
    try {
      await deleteVideo(id);
    } catch (error) {
      console.warn(`Could not remove source ${id} after a project load failed:`, error);
    }
  }
}

/**
 * The restore loop both file versions share, with its progress reports. A
 * throw anywhere in it (a write, a thumbnail write, a metadata probe, a v1
 * source's base64) rolls back what this load stored, then rethrows the
 * original error (ESCSUITE-260).
 */
async function restoreSources(
  count: number,
  restoreOne: (i: number, written: string[]) => Promise<SourceVideo>,
  onProgress?: (progress: number, message: string) => void
): Promise<SourceVideo[]> {
  onProgress?.(10, 'Restoring videos...');
  const restored: SourceVideo[] = [];
  const written: string[] = [];
  try {
    for (let i = 0; i < count; i++) {
      onProgress?.(10 + ((i + 1) / count) * 80, `Restoring video ${i + 1}/${count}...`);
      restored.push(await restoreOne(i, written));
    }
  } catch (error) {
    await rollBack(written);
    throw error;
  }
  return restored;
}

/**
 * A v1 file: one JSON document with every source base64-encoded inside it.
 * Unchanged since before ESCSUITE-260 except that each source now goes
 * through the shared `restoreSource`.
 */
async function loadJsonFile(
  file: File,
  onProgress?: (progress: number, message: string) => void
): Promise<LoadedFile> {
  const projectFile: ProjectFile = JSON.parse(await file.text());

  if (projectFile.version > JSON_FILE_VERSION) {
    throw new Error(
      `Project file version ${projectFile.version} is newer than supported version ${JSON_FILE_VERSION}`
    );
  }

  const sourceVideos = await restoreSources(
    projectFile.videos.length,
    async (i, written) => {
      const videoData = projectFile.videos[i];
      const blob = base64ToBlob(videoData.data, videoData.mimeType);
      // v1 never recorded a thumbnail's type; every one ESCAPEARTIST wrote was a JPEG.
      const thumbnail = videoData.thumbnail ? base64ToBlob(videoData.thumbnail, 'image/jpeg') : undefined;
      return restoreSource(videoData, blob, thumbnail, await getVideo(videoData.id), written);
    },
    onProgress
  );
  return { project: projectFile.project, editor: projectFile.editor, sourceVideos };
}

/**
 * Refuses, before anything is written, a v2 load whose new media will not fit
 * in what the browser says is free (ESCSUITE-260). A source already stored
 * writes nothing (ESCSUITE-151) and is not counted. The sum is exact, so no
 * margin is added. The estimate is approximate and per-browser, so a load
 * that passes can still fail while writing; `restoreSources`' rollback covers
 * that. With no `navigator.storage.estimate`, the shared helper answers all
 * zeros. A quota of 0 means nothing was measured, and the check is skipped
 * rather than refusing every load. A negative `available` (usage already over
 * quota) counts as nothing free.
 */
async function assertRoomFor(index: ProjectFileIndex, existing: StoredSource[]): Promise<void> {
  const needed = index.videos.reduce(
    (sum, video, i) => (existing[i] ? sum : sum + video.data.length + (video.thumbnail?.length ?? 0)),
    0
  );
  const { quota, available } = await getStorageEstimate();
  const free = Math.max(0, available);
  if (quota > 0 && needed > free) {
    throw new ProjectFileError(
      `This project needs ${formatSize(needed)} of storage and this browser has ${formatSize(free)} free.`
    );
  }
}

/**
 * A v2 container (ESCSUITE-260). The ranges are checked before anything is
 * written, and each part is a lazy slice of `file`, handed straight to
 * storage and to the metadata probes. A source never enters the JS heap.
 */
async function loadContainer(
  file: File,
  index: ProjectFileIndex,
  payloadStart: number,
  onProgress?: (progress: number, message: string) => void
): Promise<LoadedFile> {
  assertRangesTile(index, payloadStart, file.size);
  const existing = await Promise.all(index.videos.map((video) => getVideo(video.id)));
  await assertRoomFor(index, existing);

  const sourceVideos = await restoreSources(
    index.videos.length,
    async (i, written) => {
      const video = index.videos[i];
      const blob = sliceRange(file, payloadStart, video.data, video.mimeType);
      const thumbnail = video.thumbnail
        ? sliceRange(file, payloadStart, video.thumbnail, video.thumbnail.mimeType)
        : undefined;
      return restoreSource(video, blob, thumbnail, existing[i], written);
    },
    onProgress
  );
  return { project: index.project, editor: index.editor, sourceVideos };
}

/**
 * Load a project from a `.veditor` file of either version. The first 16 bytes
 * decide: a v2 header goes through the index and slices, and anything else
 * takes the v1 path. A v2 file this refuses throws `ProjectFileError`.
 */
export async function loadProject(
  file: File,
  onProgress?: (progress: number, message: string) => void
): Promise<{ project: Project; sourceVideos: SourceVideo[]; editor?: unknown }> {
  onProgress?.(0, 'Reading project file...');

  const container = await readProjectFileIndex(file);
  const loaded = container
    ? await loadContainer(file, container.index, container.payloadStart, onProgress)
    : await loadJsonFile(file, onProgress);

  onProgress?.(95, 'Finalizing...');

  const project: Project = {
    ...loaded.project,
    modified: Date.now(),
  };

  onProgress?.(100, 'Project loaded!');

  // Handed back as found: `parseProject` validates it (a file is untrusted).
  return { project, sourceVideos: loaded.sourceVideos, editor: loaded.editor };
}

/**
 * Extract metadata from a blob (handles video, image, and audio)
 */
export async function extractMetadataFromBlob(
  blob: Blob,
  savedData: { id: string; name: string; mimeType: string }
): Promise<SourceVideo> {
  const mimeType = savedData.mimeType;

  if (mimeType.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      const url = URL.createObjectURL(blob);
      img.src = url;

      img.onload = () => {
        const metadata: SourceVideo = {
          id: savedData.id,
          name: savedData.name,
          duration: 5, // Default image duration
          width: img.naturalWidth,
          height: img.naturalHeight,
          frameRate: 1,
          frameRateSource: 'assumed',
          mimeType,
          size: blob.size,
          mediaType: 'image',
        };
        URL.revokeObjectURL(url);
        resolve(metadata);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image: ${savedData.name}`));
      };
    });
  }

  if (mimeType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const url = URL.createObjectURL(blob);
    audio.src = url;

    // Routed through the same probe `extractAudioMetadata` uses (ESCSUITE-97):
    // a headerless ESCAPECRAFT WebM reports `Infinity` on `loadedmetadata`,
    // and a save/reopen round trip through this fallback must not
    // reintroduce that after the duration-probe work removed it elsewhere.
    const duration = await loadMediaDuration(audio, url, savedData.name, 'audio');

    return {
      id: savedData.id,
      name: savedData.name,
      duration,
      width: 0,
      height: 0,
      frameRate: 0,
      frameRateSource: 'assumed',
      mimeType,
      size: blob.size,
      mediaType: 'audio',
    };
  }

  // Default: treat as video
  const video = document.createElement('video');
  video.preload = 'metadata';

  const url = URL.createObjectURL(blob);
  video.src = url;

  const duration = await loadMediaDuration(video, url, savedData.name, 'video');

  return {
    id: savedData.id,
    name: savedData.name,
    duration,
    width: video.videoWidth,
    height: video.videoHeight,
    frameRate: 30,
    frameRateSource: 'assumed',
    mimeType,
    size: blob.size,
  };
}

/**
 * Show native file picker for loading project
 */
export async function showOpenProjectDialog(): Promise<File | null> {
  // Try File System Access API first (modern browsers)
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'Video Editor Project',
            accept: { 'application/json': ['.veditor'] },
          },
        ],
      });
      return await handle.getFile();
    } catch (e) {
      // User cancelled or API not available
      if ((e as Error).name !== 'AbortError') {
        console.warn('File picker failed, falling back to input element');
      }
    }
  }

  // Fallback to input element
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.veditor,application/json';

    input.onchange = () => {
      const file = input.files?.[0] || null;
      resolve(file);
    };

    input.oncancel = () => {
      resolve(null);
    };

    input.click();
  });
}

/**
 * Export just the project metadata (without video data) for lightweight sharing
 */
export function exportProjectMetadata(project: Project): string {
  const metadata = {
    version: JSON_FILE_VERSION,
    project,
    exportedAt: Date.now(),
  };

  return JSON.stringify(metadata, null, 2);
}

/**
 * Import project metadata (requires videos to already be loaded)
 */
export function importProjectMetadata(
  json: string,
  sourceVideos: SourceVideo[]
): Project {
  const data = JSON.parse(json);

  // Validate that all referenced videos exist
  const videoIds = new Set(sourceVideos.map((v) => v.id));
  const missingVideos = data.project.timeline.clips.filter(
    (c: Clip) => !videoIds.has(c.sourceVideoId)
  );

  if (missingVideos.length > 0) {
    throw new Error(
      `Missing videos for ${missingVideos.length} clip(s). Please load the source videos first.`
    );
  }

  return {
    ...data.project,
    modified: Date.now(),
  };
}
