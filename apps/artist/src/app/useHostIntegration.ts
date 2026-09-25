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
//
// The `?loadVideo=` branch resolves a **take**, not a file: since ESCSUITE-14 a
// recording can be several parts sharing a `takeId`, so `takeImport.ts` brings
// them all into the library and `placeTakeOnTimeline` puts them on the timeline
// in one undo step. The store action is reached through `getState()` rather than
// taken as a dep, so `App` gains no selector (`App.rerender.test.tsx`).
import { useEffect } from 'react';
import { useEditorStore, DEFAULT_PROJECT_NAME } from '../store/projectStore';
import { initIntegration, loadVideoFromUrl, sendMessage, type UrlParams } from '../utils/integration';
import { processVideoFile } from '../core/videoProcessor';
import { getVideo } from '../core/storage';
import { importTake } from './takeImport';
import { takeLoadedMessage } from './appFormat';
import { setTheme, getTheme, getResolvedTheme, type ThemePreference } from '@escapesuite/shared/theme';
import type { Project, SourceVideo } from '../store/types';
import type { ShowNotification } from './useNotification';

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

    // The ?loadVideo= thumbnails' blob URLs, handed back in the cleanup below.
    // They are handed to `addSourceVideo` and live as long as the media library
    // entries, so they cannot be revoked at the point they are created. A take
    // can be several parts since ESCSUITE-14, so there can be several.
    const thumbnailObjectUrls: string[] = [];

    // Set by the cleanup, read by the import once its storage reads land. The
    // import is far longer than the effect it belongs to can be relied on to
    // outlive — a metadata scan plus a getVideo and a getThumbnail per part —
    // and two things go wrong without it:
    //
    //   * StrictMode (every dev build: `bootstrapApp` wraps App in it) mounts
    //     the effect, cleans it up and mounts it again, so two imports run at
    //     once. The library guard below cannot separate them, because the first
    //     is still awaiting storage when the second one checks; only the run
    //     whose effect is gone knowing to stand down keeps the take from being
    //     placed twice. `addSourceVideo` is idempotent by id, so the library
    //     survived this before there was anything to place;
    //   * an unmount mid-import would otherwise have the cleanup revoke an
    //     array that is still empty, leaving the URLs pushed after it leaked,
    //     and land a `placeTakeOnTimeline` in a project the editor has left.
    let cancelled = false;

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
          // Nothing has been created or written yet, so leaving here costs
          // nothing and saves the whole import.
          if (cancelled) return;
          if (videoData) {
            // Check if video is already loaded
            const existingVideos = useEditorStore.getState().sourceVideos;
            if (!existingVideos.some(v => v.id === loadVideoId)) {
              // The id names a take's **primary** part, and a take can be
              // several files sharing a takeId (ESCSUITE-14). Every part joins
              // the library; every part that can be placed goes on the
              // timeline, in one undo step — for every take, not only one
              // recorded as separate tracks (decision 7).
              const take = await importTake(videoData, addSourceVideo);
              if (cancelled) {
                // This effect is gone: its parts are in the library (harmless,
                // and the run that replaced it adds the same ids), but the
                // timeline and the toast belong to whoever is still mounted.
                for (const url of take.thumbnailUrls) URL.revokeObjectURL(url);
                return;
              }
              thumbnailObjectUrls.push(...take.thumbnailUrls);
              useEditorStore.getState().placeTakeOnTimeline(take.clipParts);

              showNotification(
                takeLoadedMessage(
                  videoData.metadata.name,
                  take.clipParts.length,
                  take.missingParts
                ),
                // One toast slot: a take that lost a part says so instead of
                // reporting a clean success the user would read as one.
                take.missingParts > 0 ? 'info' : 'success'
              );
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

    return () => {
      cancelled = true;
      cleanup();
      for (const url of thumbnailObjectUrls) URL.revokeObjectURL(url);
    };
  }, []);
}
