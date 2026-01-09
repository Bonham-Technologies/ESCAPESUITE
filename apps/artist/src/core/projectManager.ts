// Project save/load functionality

import type { Project, SourceVideo, Clip } from '../store/types';
import { getVideo, storeVideo, storeThumbnail, getThumbnail } from './storage';

export interface ProjectFile {
  version: number;
  project: Project;
  videos: {
    id: string;
    name: string;
    mimeType: string;
    data: string; // Base64 encoded video data
    thumbnail?: string; // Base64 encoded thumbnail
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

      projectFile.videos.push({
        id: video.id,
        name: video.name,
        mimeType: video.mimeType,
        data: base64Data,
        thumbnail: thumbnailBase64,
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

    // Extract metadata from blob
    const metadata = await extractMetadataFromBlob(blob, videoData);

    // Store video
    await storeVideo(videoData.id, blob, metadata);

    // Store thumbnail if present
    if (videoData.thumbnail) {
      const thumbnailBlob = base64ToBlob(videoData.thumbnail, 'image/jpeg');
      await storeThumbnail(videoData.id, thumbnailBlob);
      metadata.thumbnailUrl = URL.createObjectURL(thumbnailBlob);
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
 * Extract video metadata from a blob
 */
async function extractMetadataFromBlob(
  blob: Blob,
  savedData: { id: string; name: string; mimeType: string }
): Promise<SourceVideo> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const url = URL.createObjectURL(blob);
    video.src = url;

    video.onloadedmetadata = () => {
      const metadata: SourceVideo = {
        id: savedData.id,
        name: savedData.name,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        frameRate: 30, // Default
        mimeType: savedData.mimeType,
        size: blob.size,
      };

      URL.revokeObjectURL(url);
      resolve(metadata);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load video: ${savedData.name}`));
    };
  });
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
