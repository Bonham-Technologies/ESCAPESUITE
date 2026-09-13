// The host integration surface: the inbound postMessage handler and the
// startup work the URL parameters ask for.
//
// Its effect is the editor's **sixth and last**, so `App` calls this hook
// ninth.
//
// The deps array is `[]` — mount-only — even though the effect closes over
// `addSourceVideo`, `setProject`, `showNotification` and `urlParams`. That is
// deliberate and carried from the inline version: the handler is installed
// once, and `GET_STATE` works around the staleness with an explicit
// `useEditorStore.getState()` (see its comment). The other cases rely on those
// four being stable for the component's life, which they are.
import { useEffect } from 'react';
import { useEditorStore, DEFAULT_PROJECT_NAME } from '../store/projectStore';
import { initIntegration, loadVideoFromUrl, sendMessage, type parseUrlParams } from '../utils/integration';
import { processVideoFile } from '../core/videoProcessor';
import { getVideo, getThumbnail } from '../core/storage';
import { setTheme, getTheme, getResolvedTheme, type ThemePreference } from '@escapesuite/shared/theme';
import type { Project, SourceVideo } from '../store/types';
import type { ShowNotification } from './useNotification';

/** The URL parameters, read once at startup. */
export type UrlParams = ReturnType<typeof parseUrlParams>;

/** What the host surface needs from the editor. */
export interface HostIntegrationDeps {
  /** The startup URL parameters — read once, never re-read. */
  urlParams: UrlParams;
  addSourceVideo: (video: SourceVideo) => void;
  setProject: (project: Project) => void;
  showNotification: ShowNotification;
}

export function useHostIntegration({
  urlParams,
  addSourceVideo,
  setProject,
  showNotification,
}: HostIntegrationDeps): void {
  // Initialize integration API
  useEffect(() => {
    const cleanup = initIntegration(async (message) => {
      switch (message.type) {
        case 'LOAD_VIDEO':
          if (message.payload && typeof message.payload === 'object' && 'url' in message.payload) {
            try {
              const { blob, name } = await loadVideoFromUrl((message.payload as { url: string }).url);
              const file = new File([blob], name, { type: blob.type });
              const metadata = await processVideoFile(file);
              addSourceVideo(metadata);
              sendMessage({ type: 'VIDEO_LOADED', payload: { id: metadata.id, name: metadata.name } });
            } catch (error) {
              sendMessage({ type: 'ERROR', payload: { message: 'Failed to load video', code: 'LOAD_ERROR' } });
            }
          }
          break;

        case 'LOAD_PROJECT':
          if (message.payload) {
            setProject(message.payload as any);
          }
          break;

        case 'GET_STATE': {
          // Read the store now — this handler is installed once on mount, so
          // the closed-over project/sourceVideos would be forever stale.
          const state = useEditorStore.getState();
          sendMessage({
            type: 'STATE',
            payload: { project: state.project, videos: state.sourceVideos },
          });
          break;
        }

        case 'SET_THEME':
          if (message.payload && typeof message.payload === 'object' && 'theme' in message.payload) {
            const themeValue = (message.payload as { theme: string }).theme;
            if (['light', 'dark', 'system'].includes(themeValue)) {
              setTheme(themeValue as ThemePreference).then(() => {
                sendMessage({
                  type: 'THEME_CHANGED',
                  payload: { preference: getTheme(), resolved: getResolvedTheme() },
                });
              });
            }
          }
          break;

        case 'GET_THEME':
          sendMessage({
            type: 'THEME_STATE',
            payload: { preference: getTheme(), resolved: getResolvedTheme() },
          });
          break;
      }
    });

    // Check for URL parameters (parsed once at startup)
    const { videos, loadVideoId, title } = urlParams;

    // Load videos from URL parameters
    if (videos.length > 0) {
      videos.forEach(async (url) => {
        try {
          const { blob, name } = await loadVideoFromUrl(url);
          const file = new File([blob], name, { type: blob.type });
          const metadata = await processVideoFile(file);
          addSourceVideo(metadata);
        } catch (error) {
          console.error('Failed to load video from URL:', error);
        }
      });
    }

    // Load video by ID from IndexedDB (ESCAPECRAFT integration)
    if (loadVideoId) {
      (async () => {
        try {
          const videoData = await getVideo(loadVideoId);
          if (videoData) {
            // Check if video is already loaded
            const existingVideos = useEditorStore.getState().sourceVideos;
            if (!existingVideos.some(v => v.id === loadVideoId)) {
              // Get thumbnail if available
              let thumbnailUrl: string | undefined;
              const thumbnailBlob = await getThumbnail(loadVideoId);
              if (thumbnailBlob) {
                thumbnailUrl = URL.createObjectURL(thumbnailBlob);
              }

              // Add video to source videos
              addSourceVideo({
                ...videoData.metadata,
                thumbnailUrl,
              });

              showNotification(`Loaded recording: ${videoData.metadata.name}`, 'success');
            }
          } else {
            console.error('Video not found in IndexedDB:', loadVideoId);
            showNotification('Recording not found', 'error');
          }
        } catch (error) {
          console.error('Failed to load video from IndexedDB:', error);
          showNotification('Failed to load recording', 'error');
        }
      })();
    }

    // Apply a host-supplied title. Only fills in a project that has never been
    // named - it never overrides a name from ?project= data or a restored session.
    if (title) {
      const current = useEditorStore.getState().project;
      if (current.name === DEFAULT_PROJECT_NAME) {
        setProject({ ...current, name: title, modified: Date.now() });
        // Naming the project is the host's doing, not an edit — leave nothing
        // for the user to undo back past (handleRestoreSession does the same).
        useEditorStore.getState().clearHistory();
      }
    }

    return cleanup;
  }, []);
}
