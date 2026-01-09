// Integration API for embedding video editor in other applications
// Supports URL parameters and PostMessage communication

import type { IntegrationMessage, Project } from '../store/types';

type MessageHandler = (message: IntegrationMessage) => void;

/**
 * Initialize PostMessage listener
 */
export function initIntegration(handler: MessageHandler): () => void {

  const listener = (event: MessageEvent) => {
    // Validate message structure
    if (!event.data || typeof event.data !== 'object' || !event.data.type) {
      return;
    }

    const message: IntegrationMessage = {
      type: event.data.type,
      payload: event.data.payload,
    };

    handler(message);
  };

  window.addEventListener('message', listener);

  // Signal that the editor is ready
  sendMessage({ type: 'READY' });

  // Return cleanup function
  return () => {
    window.removeEventListener('message', listener);
  };
}

/**
 * Send message to parent window
 */
export function sendMessage(message: IntegrationMessage): void {
  if (window.parent !== window) {
    window.parent.postMessage(message, '*');
  }

  // Also dispatch as custom event for same-window integration
  window.dispatchEvent(
    new CustomEvent('videoeditor:message', { detail: message })
  );
}

/**
 * Parse URL parameters for initial configuration
 */
export function parseUrlParams(): {
  videos: string[];
  projectData: string | null;
  autoPlay: boolean;
  loadVideoId: string | null;
} {
  const params = new URLSearchParams(window.location.search);

  // Get video URLs (can be multiple: ?video=url1&video=url2)
  const videos = params.getAll('video');

  // Get project data (base64 encoded JSON)
  const projectData = params.get('project');

  // Auto-play flag
  const autoPlay = params.get('autoplay') === 'true';

  // Load video by ID from IndexedDB (from ESCAPECRAFT integration)
  const loadVideoId = params.get('loadVideo');

  return { videos, projectData, autoPlay, loadVideoId };
}

/**
 * Load video from URL
 */
export async function loadVideoFromUrl(
  url: string,
  onProgress?: (progress: number) => void
): Promise<{ blob: Blob; name: string }> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch video: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    // No streaming support, just get blob directly
    const blob = await response.blob();
    return { blob, name: extractFilename(url) };
  }

  // Stream the response for progress tracking
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value);
    received += value.length;

    if (total && onProgress) {
      onProgress((received / total) * 100);
    }
  }

  // Combine chunks into a single ArrayBuffer
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const blob = new Blob([combined], {
    type: response.headers.get('content-type') || 'video/mp4',
  });

  return { blob, name: extractFilename(url) };
}

/**
 * Extract filename from URL
 */
function extractFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const parts = pathname.split('/');
    const filename = parts[parts.length - 1];

    if (filename) {
      return decodeURIComponent(filename);
    }
  } catch {
    // Invalid URL
  }

  return 'video.mp4';
}

/**
 * Decode base64 project data from URL parameter
 */
export function decodeProjectData(encoded: string): Project | null {
  try {
    const decoded = atob(encoded);
    return JSON.parse(decoded);
  } catch (e) {
    console.error('Failed to decode project data:', e);
    return null;
  }
}

/**
 * Encode project data for URL parameter
 */
export function encodeProjectData(project: Project): string {
  return btoa(JSON.stringify(project));
}

/**
 * Generate shareable URL with current project state
 */
export function generateShareUrl(
  baseUrl: string,
  project: Project,
  videoUrls: string[]
): string {
  const url = new URL(baseUrl);

  // Add video URLs
  videoUrls.forEach((videoUrl) => {
    url.searchParams.append('video', videoUrl);
  });

  // Add encoded project data
  url.searchParams.set('project', encodeProjectData(project));

  return url.toString();
}

/**
 * Integration message types for documentation:
 *
 * Incoming messages (from parent):
 * - LOAD_VIDEO: { url: string } - Load a video from URL
 * - LOAD_PROJECT: { data: Project } - Load a project
 * - EXPORT: { format: 'webm' | 'mp4' } - Trigger export
 * - GET_STATE: {} - Request current state
 * - SET_THEME: { theme: 'light' | 'dark' | 'system' } - Set theme preference
 * - GET_THEME: {} - Request current theme state
 *
 * Outgoing messages (to parent):
 * - READY: {} - Editor is initialized and ready
 * - VIDEO_LOADED: { id: string, name: string } - Video was loaded
 * - EXPORT_COMPLETE: { blob: Blob, format: string } - Export finished
 * - EXPORT_PROGRESS: { progress: number, message: string } - Export progress
 * - STATE: { project: Project, videos: SourceVideo[] } - Current state
 * - ERROR: { message: string, code: string } - Error occurred
 * - THEME_CHANGED: { preference: string, resolved: string } - Theme was changed
 * - THEME_STATE: { preference: string, resolved: string } - Current theme state
 */
