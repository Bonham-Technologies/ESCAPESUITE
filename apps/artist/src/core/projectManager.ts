// Project save/load functionality

import type { Project, SourceVideo, Clip } from '../store/types';
import { getVideo, storeVideo, storeThumbnail, getThumbnail, resolveThumbnailUrl } from './storage';
import { loadMediaDuration, resolveStoredDuration } from './videoProcessor';

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

export interface ProjectFile {
  version: number;
  project: Project;
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

const CURRENT_VERSION = 1;

/**
 * Convert a Blob to base64 string
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

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
 * Save project to a downloadable file
 */
export async function saveProject(
  project: Project,
  sourceVideos: SourceVideo[],
  onProgress?: (progress: number, message: string) => void
): Promise<void> {
  onProgress?.(0, 'Preparing project data...');

  // Get all videos used in the timeline
  const usedVideoIds = new Set(project.timeline.clips.map((c) => c.sourceVideoId));
  const usedVideos = sourceVideos.filter((v) => usedVideoIds.has(v.id));

  const projectFile: ProjectFile = {
    version: CURRENT_VERSION,
    project,
    videos: [],
  };

  // Export each video with its data
  for (let i = 0; i < usedVideos.length; i++) {
    const video = usedVideos[i];
    onProgress?.(
      ((i + 1) / usedVideos.length) * 80,
      `Exporting video ${i + 1}/${usedVideos.length}...`
    );

    const videoData = await getVideo(video.id);
    if (videoData) {
      const base64Data = await blobToBase64(videoData.blob);

      let thumbnailBase64: string | undefined;
      const thumbnail = await getThumbnail(video.id);
      if (thumbnail) {
        thumbnailBase64 = await blobToBase64(thumbnail);
      }

      const meta: SourceVideoMeta = {
        duration: video.duration,
        width: video.width,
        height: video.height,
        frameRate: video.frameRate,
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

      projectFile.videos.push({
        id: video.id,
        name: video.name,
        mimeType: video.mimeType,
        data: base64Data,
        thumbnail: thumbnailBase64,
        meta,
      });
    }
  }

  onProgress?.(90, 'Creating project file...');

  // Create JSON file
  const jsonContent = JSON.stringify(projectFile);
  const blob = new Blob([jsonContent], { type: 'application/json' });

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

/**
 * Load project from a file
 */
export async function loadProject(
  file: File,
  onProgress?: (progress: number, message: string) => void
): Promise<{ project: Project; sourceVideos: SourceVideo[] }> {
  onProgress?.(0, 'Reading project file...');

  // Read file content
  const content = await file.text();
  const projectFile: ProjectFile = JSON.parse(content);

  // Validate version
  if (projectFile.version > CURRENT_VERSION) {
    throw new Error(
      `Project file version ${projectFile.version} is newer than supported version ${CURRENT_VERSION}`
    );
  }

  onProgress?.(10, 'Restoring videos...');

  const sourceVideos: SourceVideo[] = [];

  // Restore videos to IndexedDB
  for (let i = 0; i < projectFile.videos.length; i++) {
    const videoData = projectFile.videos[i];
    onProgress?.(
      10 + ((i + 1) / projectFile.videos.length) * 80,
      `Restoring video ${i + 1}/${projectFile.videos.length}...`
    );

    // Convert base64 back to blob
    const blob = base64ToBlob(videoData.data, videoData.mimeType);

    // A source already in the shared DB — most likely a take ESCAPECRAFT
    // still owns, or one an earlier import/load already restored — keeps
    // exactly the metadata it already has. A `.veditor` load restores the
    // bytes ARTIST needs; it is not authority over metadata it does not own
    // (ESCSUITE-151), so even an identical-looking `meta` in the file must
    // not overwrite what is already stored.
    const existing = await getVideo(videoData.id);

    // A file saved since ESCSUITE-97 carries the live SourceVideo's own
    // fields in `meta` — waveform peaks, take identity, the real frame rate —
    // so those are trusted in preference to a blob probe. But `meta` came out
    // of `JSON.parse`, not the type checker: a hand-edited or corrupted file
    // can still carry a `duration`/`width`/`height` that is not a usable
    // number (review round 1), so each is validated and, only when it fails,
    // recovered from the blob rather than stored unquestioned. The common
    // case — a `meta` written by this same `saveProject` — never touches the
    // blob at all.
    //
    // An older file has no `meta` at all, and falls back to reconstructing
    // everything from the blob (through `extractMetadataFromBlob`, which
    // itself now goes through the same duration probe every other importer
    // uses).
    let metadata: SourceVideo;
    if (existing) {
      metadata = {
        ...existing.metadata,
        // thumbnailUrl is a live `blob:` handle that never survives a reload
        // on its own (ESCSUITE-96) — refreshed here; nothing else is touched.
        thumbnailUrl: await resolveThumbnailUrl(videoData.id),
      };
    } else if (videoData.meta) {
      const duration = await resolveStoredDuration(blob, {
        ...videoData.meta,
        name: videoData.name,
      } as SourceVideo);
      const { width, height } = await resolveMetaDimensions(blob, videoData.meta, videoData);
      metadata = {
        ...videoData.meta,
        id: videoData.id,
        name: videoData.name,
        mimeType: videoData.mimeType,
        size: blob.size,
        duration,
        width,
        height,
      };

      // A stored thumbnail (below) is the only legitimate source of a live
      // `thumbnailUrl` — never a value that arrived in the file itself.
      // `meta` is typed to exclude `thumbnailUrl`, but nothing stops a
      // hand-edited file from smuggling one in through the `...videoData.meta`
      // spread above, and it must not reach IndexedDB via `storeVideo` below
      // (ESCSUITE-96 is exactly the failure mode a stale `blob:` handle in
      // storage causes) or survive into the returned `SourceVideo` when the
      // file has no real thumbnail to resolve over it (review round 1).
      delete metadata.thumbnailUrl;

      // This id is not already in the shared DB, so restoring it resurrects a
      // copy under an identity CRAFT no longer recognises as live. A
      // `source: 'recording'` here would put a take the user deleted in
      // CRAFT straight back into CRAFT's own library
      // (`getAllVideoMetadata().filter(v => v.source === 'recording')`,
      // apps/craft/src/core/storage.ts), and `takeId`/`role`/`startOffset`/
      // `overlayPlacement` describe a take-group this restored copy is not
      // part of (ESCSUITE-151). Cleared outright, not set to `'import'`:
      // ARTIST's own importers (`core/videoProcessor.ts`) never write a
      // `source` on a dragged-in file either — it's simply absent.
      delete metadata.source;
      delete metadata.takeId;
      delete metadata.role;
      delete metadata.startOffset;
      delete metadata.overlayPlacement;
    } else {
      metadata = await extractMetadataFromBlob(blob, videoData);
    }

    if (!existing) {
      // Store video
      await storeVideo(videoData.id, blob, metadata);

      // Store thumbnail if present
      if (videoData.thumbnail) {
        const thumbnailBlob = base64ToBlob(videoData.thumbnail, 'image/jpeg');
        await storeThumbnail(videoData.id, thumbnailBlob);
        metadata.thumbnailUrl = await resolveThumbnailUrl(videoData.id);
      }
    }

    sourceVideos.push(metadata);
  }

  onProgress?.(95, 'Finalizing...');

  // Update project timestamps
  const project: Project = {
    ...projectFile.project,
    modified: Date.now(),
  };

  onProgress?.(100, 'Project loaded!');

  return { project, sourceVideos };
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
    version: CURRENT_VERSION,
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
