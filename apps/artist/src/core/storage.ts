// IndexedDB storage layer for video blobs and project data

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { SourceVideo, Project } from '../store/types';

// Session state for auto-save/restore
export interface SessionState {
  project: Project;
  sourceVideos: SourceVideo[];
  currentTime: number;
  selectedClipId: string | null;
  zoom: number;
  timestamp: number;
}

interface VideoEditorDB extends DBSchema {
  videos: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      metadata: SourceVideo;
    };
  };
  thumbnails: {
    key: string;
    value: {
      id: string;
      blob: Blob;
    };
  };
  projects: {
    key: string;
    value: Project;
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'video-editor-db';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<VideoEditorDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<VideoEditorDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<VideoEditorDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Videos store - holds the actual video blobs
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'id' });
      }

      // Thumbnails store
      if (!db.objectStoreNames.contains('thumbnails')) {
        db.createObjectStore('thumbnails', { keyPath: 'id' });
      }

      // Projects store
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    },
  });

  return dbInstance;
}

// Video operations
export async function storeVideo(id: string, blob: Blob, metadata: SourceVideo): Promise<void> {
  const db = await getDB();
  await db.put('videos', { id, blob, metadata });
}

export async function getVideo(id: string): Promise<{ blob: Blob; metadata: SourceVideo } | undefined> {
  const db = await getDB();
  const record = await db.get('videos', id);
  if (record) {
    return { blob: record.blob, metadata: record.metadata };
  }
  return undefined;
}

export async function getVideoBlob(id: string): Promise<Blob | undefined> {
  const record = await getVideo(id);
  return record?.blob;
}

export async function getAllVideoMetadata(): Promise<SourceVideo[]> {
  const db = await getDB();
  const records = await db.getAll('videos');
  return records.map(r => r.metadata);
}

export async function deleteVideo(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('videos', id);
  await db.delete('thumbnails', id);
}

// Thumbnail operations
export async function storeThumbnail(id: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('thumbnails', { id, blob });
}

export async function getThumbnail(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const record = await db.get('thumbnails', id);
  return record?.blob;
}

// Project operations
export async function storeProject(project: Project): Promise<void> {
  const db = await getDB();
  await db.put('projects', project);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  return db.get('projects', id);
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDB();
  return db.getAll('projects');
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('projects', id);
}

// Settings operations
export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('settings', value, key);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get('settings', key) as Promise<T | undefined>;
}

// Utility to clear all data (for testing/reset)
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear('videos');
  await db.clear('thumbnails');
  await db.clear('projects');
  await db.clear('settings');
}

// Get storage usage estimate
export async function getStorageEstimate(): Promise<{ used: number; quota: number; available: number }> {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage || 0;
    const quota = estimate.quota || 0;
    return {
      used,
      quota,
      available: quota - used,
    };
  }
  return { used: 0, quota: 0, available: 0 };
}

// Check if there's enough space for a file
export async function hasSpaceForFile(fileSize: number): Promise<boolean> {
  const { available } = await getStorageEstimate();
  // Leave 10MB buffer
  return available > fileSize + 10 * 1024 * 1024;
}

// Get total size of all stored videos
export async function getTotalVideoSize(): Promise<number> {
  const db = await getDB();
  const records = await db.getAll('videos');
  return records.reduce((total, record) => total + (record.blob?.size || 0), 0);
}

// Delete all videos (but keep projects and settings)
export async function clearAllVideos(): Promise<void> {
  const db = await getDB();
  await db.clear('videos');
  await db.clear('thumbnails');
}

// Session state operations (auto-save/restore)
const SESSION_KEY = 'current-session';

export async function saveSessionState(session: SessionState): Promise<void> {
  const db = await getDB();
  await db.put('settings', session, SESSION_KEY);
}

export async function getSessionState(): Promise<SessionState | undefined> {
  const db = await getDB();
  return db.get('settings', SESSION_KEY) as Promise<SessionState | undefined>;
}

export async function clearSessionState(): Promise<void> {
  const db = await getDB();
  await db.delete('settings', SESSION_KEY);
}
