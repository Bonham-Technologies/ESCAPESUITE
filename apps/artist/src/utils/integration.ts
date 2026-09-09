// Integration API for embedding video editor in other applications
// Supports URL parameters and PostMessage communication

import { isEmbedded, parseHostOrigin } from '@escapesuite/shared/config';
import type { IntegrationMessage, Project } from '../store/types';

// Longest project name accepted from the `title` URL parameter.
const MAX_TITLE_LENGTH = 120;

type MessageHandler = (message: IntegrationMessage) => void;

// The origin a host named with `?hostOrigin=`, or null when it named none.
// `undefined` means "not resolved yet": the URL is read once, on first use, and
// the answer is reused for the life of the page.
let hostOrigin: string | null | undefined;

function getHostOrigin(): string | null {
  if (hostOrigin === undefined) {
    hostOrigin = parseHostOrigin(window.location.search);
  }
  return hostOrigin;
}

/** Test seam: pin the host origin without going through window.location. */
export function __setHostOriginForTests(origin: string | null): void {
  hostOrigin = origin;
}

/**
 * Initialize PostMessage listener
 */
export function initIntegration(handler: MessageHandler): () => void {
  const listener = (event: MessageEvent) => {
    // Only the embedding parent drives the editor. Without `?hostOrigin=` that
    // is the whole check — any origin may frame us, and the framer is the only
    // window whose messages we act on. With it, the host has also named itself,
    // so messages arriving from anywhere else are dropped.
    if (event.source !== window.parent) {
      return;
    }
    const expectedOrigin = getHostOrigin();
    if (expectedOrigin && event.origin !== expectedOrigin) {
      return;
    }

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
  if (isEmbedded()) {
    // A host that named itself with `?hostOrigin=` gets its traffic addressed to
    // that origin; otherwise the message goes to whoever is framing us.
    window.parent.postMessage(message, getHostOrigin() ?? '*');
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
  suppressRestore: boolean;
  title: string | null;
  hostOrigin: string | null;
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

  // Skip the "Resume Previous Session?" prompt (hosts drive their own state).
  // The saved session is left in storage untouched.
  const suppressRestoreParam = params.get('suppressRestore');
  const suppressRestore = suppressRestoreParam === '1' || suppressRestoreParam === 'true';

  // Initial project name supplied by the host. Trimmed again after the cut so a
  // slice that lands on a space does not leave a trailing one.
  const rawTitle = params.get('title')?.trim().slice(0, MAX_TITLE_LENGTH).trim() ?? '';
  const title = rawTitle || null;

  // The host's own origin, for addressing postMessage traffic (see sendMessage).
  hostOrigin = parseHostOrigin(window.location.search);

  return {
    videos,
    projectData,
    autoPlay,
    loadVideoId,
    suppressRestore,
    title,
    hostOrigin,
  };
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
 *   [documented but not currently implemented - App has no handler for it]
 * - GET_STATE: {} - Request current state
 * - SET_THEME: { theme: 'light' | 'dark' | 'system' } - Set theme preference
 * - GET_THEME: {} - Request current theme state
 *
 * Only messages whose `event.source` is `window.parent` are acted on, and when
 * the host named itself with `?hostOrigin=` its `event.origin` must match too.
 *
 * Outgoing messages (to parent):
 * - READY: {} - Editor is initialized and ready
 * - VIDEO_LOADED: { id: string, name: string } - Video was loaded
 * - EXPORT_COMPLETE: { blob: Blob, format: 'mp4' | 'webm', name: string } - Export finished
 * - EXPORT_PROGRESS: { progress: number, message: string } - Export progress
 *   [documented but not currently implemented - nothing sends it]
 * - PROJECT_SAVED: {} - Project was saved
 *   [documented but not currently implemented - nothing sends it]
 * - STATE: { project: Project, videos: SourceVideo[] } - Current state
 * - ERROR: { message: string, code: string } - Error occurred
 * - THEME_CHANGED: { preference: string, resolved: string } - Theme was changed
 * - THEME_STATE: { preference: string, resolved: string } - Current theme state
 *
 * CRAFT -> host (posted by ESCAPECRAFT, not by this app — documented here so
 * one file describes the whole cross-app protocol; see
 * apps/craft/src/utils/sendToEditor.ts):
 * - SEND_TO_EDITOR: { id: string } - A recording is ready to edit. Sent to the
 *   parent window only when CRAFT is embedded; standalone CRAFT opens
 *   ESCAPEARTIST itself at VITE_EDITOR_URL (default /artist/) with
 *   ?loadVideo=<id>. The id addresses a record in the shared IndexedDB
 *   ('video-editor-db'), so the host must point its editor at the same origin.
 *   CRAFT's header "Open Editor" button is deliberately NOT routed through the
 *   host - it still opens the editor itself, embedded or not. Only "Send to
 *   Editor", which hands over a specific recording, becomes a message.
 *
 * URL parameters (read once at startup, see parseUrlParams):
 * - video=<url> - Load a video from a URL (repeatable)
 * - project=<base64> - Load a base64-encoded project
 *   [documented but not currently implemented - parsed, never applied]
 * - autoplay=true - Start playback once loaded
 *   [documented but not currently implemented - parsed, never applied]
 * - loadVideo=<id> - Load a recording from IndexedDB (ESCAPECRAFT handoff)
 * - suppressRestore=1|true - Skip the "Resume Previous Session?" prompt.
 *   ESCAPEARTIST neither offers nor writes the saved session under this flag:
 *   the session autosave is off too, so a host-driven session leaves whatever
 *   was in storage exactly as it found it.
 * - title=<name> - Initial project name (trimmed, max 120 chars); applied only
 *   when the project has not been named by project data or a restored session
 * - hostOrigin=<origin> - The host's own origin, e.g. https://host.example.
 *   Recommended for production hosts: outbound posts are addressed to it
 *   instead of '*', and inbound messages from any other origin are ignored.
 *   It protects the *host's* deployment, not against being framed - a hostile
 *   page that frames the app also controls this URL and would simply supply
 *   its own origin. Refusing to be framed is
 *   `Content-Security-Policy: frame-ancestors` on the deployment. The hosted deployment
 *   (escapesuite.io) sends `frame-ancestors 'self'` from vercel.json; self-hosted builds
 *   must set their own.
 */
