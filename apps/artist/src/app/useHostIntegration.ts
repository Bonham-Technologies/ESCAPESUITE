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
// taken as a dep, so `App` gains no selector (`App.rerender.test.tsx`), and so
// is the media library the "already loaded" guard consults — `importTake` is
// handed that lookup rather than an answer, because the take's parts are not
// known until it has scanned for them.
//
// Placement is the one thing that does **not** happen the moment the import
// lands: it waits for the "Resume Previous Session?" prompt. See
// `placePendingTake` below — which is also where the "is this take already
// here?" question is asked the *second* time, of the timeline, because the
// first one is asked of the library before a restore has filled it.
import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore, DEFAULT_PROJECT_NAME } from '../store/projectStore';
import { initIntegration, loadVideoFromUrl, sendMessage, type UrlParams } from '../utils/integration';
import { processMediaFile } from '../core/videoProcessor';
import { getVideo } from '../core/storage';
import { parseProject } from '../store/projectMigration';
import { importTake } from './takeImport';
import { takeLoadedMessage } from './appFormat';
import { setTheme, getTheme, getResolvedTheme, type ThemePreference } from '@escapesuite/shared/theme';
import type { Project, SourceVideo, TakeClipPart } from '../store/types';
import type { ShowNotification } from './useNotification';

/** What the host surface needs from the editor. */
export interface HostIntegrationDeps {
  /** The startup URL parameters — read once, never re-read. */
  urlParams: UrlParams;
  addSourceVideo: (video: SourceVideo) => void;
  setProject: (project: Project) => void;
  showNotification: ShowNotification;
  /**
   * The startup session question is **unanswered**, so the timeline is still
   * being negotiated and a handed-over take must not be written to it yet.
   *
   * Deliberately wider than "the prompt is on screen": for the first moments of
   * a load the prompt has not appeared *yet* — `getSessionState()` has not come
   * back — and a take placed in that window is discarded by the "Restore" that
   * follows it just as surely. `App` fills this from `useSessionRestore`'s
   * `sessionRestored`, which is false from the first render until the question
   * is settled one of five ways (suppressed, nothing stored, the read failed,
   * restored, declined), so it covers both halves of the wait.
   *
   * Component state in `App`, not a store selector, so this costs `App` no new
   * subscription (`App.rerender.test.tsx`).
   */
  sessionDecisionPending: boolean;
}

/** A take that has arrived in the library and is waiting for the timeline. */
interface PendingTake {
  clipParts: TakeClipPart[];
  /** The take's name, for the toast raised when it is finally placed. */
  name: string;
  missingParts: number;
}

export function useHostIntegration({
  urlParams,
  addSourceVideo,
  setProject,
  showNotification,
  sessionDecisionPending,
}: HostIntegrationDeps): void {
  // The take the handoff imported, held until the session question is settled.
  // `useSessionRestore`'s "Restore" does setProject + clearHistory, so a take
  // placed before the answer is replaced and left with no undo step back to it
  // — and ESCAPECRAFT's standalone "Send to Editor" opens /artist/?loadVideo=
  // with no ?suppressRestore=1, so that is the ordinary path, not a corner.
  // Waiting is what keeps both: restore first, append after.
  const pendingTake = useRef<PendingTake | null>(null);
  // Read by the import when its storage reads land, so a take that arrives
  // before the question is answered parks itself instead of racing it. It
  // starts `true` on a cold load, which is what stops an import that beats the
  // session read to the finish from being placed and then replaced.
  const sessionDecisionPendingRef = useRef(sessionDecisionPending);

  /**
   * Put the waiting take on the timeline, and only then say so.
   *
   * The toast travels with the placement rather than the import: "Loaded
   * recording" while the timeline is still empty is the same untruth the early
   * placement was. Nulls the ref first, so answering the prompt twice — or a
   * re-render behind it — places the take once.
   *
   * **And asks the "already here?" question a second time**, because the first
   * one was asked too early to answer it on this path. `importTake`'s
   * `isInLibrary` runs when the import's storage reads land, which on a load
   * with no `?suppressRestore=1` is *before* `handleRestoreSession` runs
   * `session.sourceVideos.forEach(addSourceVideo)` — so a saved session that
   * already holds the take (its parts in the library, its clips on the
   * timeline) gets past it, and the take would be appended a second time on two
   * more tracks. Whether the user got a duplicate or a silent skip would come
   * down to whether the import lost the race to the prompt click.
   *
   * The second question is asked of the **timeline**, not the library: by now
   * the restore has re-added every part it holds, so an id lookup can no longer
   * separate "the session already had this take" from "the import just added
   * it a moment ago". A clip already playing the part can, and is the thing a
   * second placement would duplicate anyway.
   *
   * A dropped take is dropped **silently** — the same nothing a take already in
   * the library has always been answered with. Its parts stay in the library,
   * and so do their thumbnails: since ESCSUITE-113 the store owns every
   * `SourceVideo.thumbnailUrl`, and what frees the import's handles is the
   * restore re-adding its own entries under the same ids (`addSourceVideo`'s
   * replace-in-place branch). Freeing them here as well would, for any part the
   * restore did not replace, blank a tile whose media is on the timeline.
   */
  const placePendingTake = useCallback(() => {
    const take = pendingTake.current;
    if (!take) return;
    pendingTake.current = null;
    const placed = useEditorStore.getState().project.timeline.clips;
    if (
      take.clipParts.some((part) =>
        placed.some((clip) => clip.sourceVideoId === part.sourceVideoId)
      )
    ) {
      return;
    }
    useEditorStore.getState().placeTakeOnTimeline(take.clipParts);
    showNotification(
      takeLoadedMessage(take.name, take.clipParts.length, take.missingParts),
      // One toast slot: a take that lost a part says so instead of
      // reporting a clean success the user would read as one.
      take.missingParts > 0 ? 'info' : 'success'
    );
  }, [showNotification]);

  // Initialize integration API
  useEffect(() => {
    const cleanup = initIntegration(async (message) => {
      switch (message.type) {
        case 'LOAD_VIDEO':
          if (message.payload && typeof message.payload === 'object' && 'url' in message.payload) {
            try {
              const { blob, name } = await loadVideoFromUrl((message.payload as { url: string }).url);
              const file = new File([blob], name, { type: blob.type });
              const metadata = await processMediaFile(file);
              addSourceVideo(metadata);
              sendMessage({ type: 'VIDEO_LOADED', payload: { id: metadata.id, name: metadata.name } });
            } catch (error) {
              // ESCSUITE-130: loadVideoFromUrl already names the URL's origin
              // and, for a cross-origin URL, the likely Content-Security-Policy
              // cause — pass that on rather than flattening it to one generic
              // sentence, both to the user and to the host that asked for it.
              // Named errorMessage, not message, so it does not shadow the
              // inbound postMessage this whole handler is switching on.
              const errorMessage = error instanceof Error ? error.message : 'Failed to load video';
              showNotification(errorMessage, 'error');
              sendMessage({ type: 'ERROR', payload: { message: errorMessage, code: 'LOAD_ERROR' } });
            }
          }
          break;

        case 'LOAD_PROJECT':
          if (message.payload) {
            // Validated the same way a dropped .veditor is (ESCSUITE-102):
            // ensureTimelineHasTracks assumes a shape this payload has never
            // been checked against, and a host is in no better position than
            // a malformed file to hand one — it gets an ERROR reply instead of
            // a thrown exception silently leaving the project untouched.
            const parsed = parseProject(message.payload);
            if (parsed.ok) {
              setProject(parsed.project);
            } else {
              sendMessage({
                type: 'ERROR',
                payload: { message: parsed.reason, code: 'INVALID_PROJECT' },
              });
            }
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
    //   * an unmount mid-import would otherwise land a `placeTakeOnTimeline` in
    //     a project the editor has left.
    let cancelled = false;

    // Load videos from URL parameters
    if (videos.length > 0) {
      videos.forEach(async (url) => {
        try {
          const { blob, name } = await loadVideoFromUrl(url);
          const file = new File([blob], name, { type: blob.type });
          const metadata = await processMediaFile(file);
          addSourceVideo(metadata);
        } catch (error) {
          console.error('Failed to load video from URL:', error);
          // ESCSUITE-130: same message loadVideoFromUrl raised for the
          // console — names the origin and, cross-origin, the CSP — rather
          // than a generic failure the user cannot act on.
          showNotification(
            error instanceof Error ? error.message : 'Failed to load video',
            'error'
          );
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
            // The id names a take's **primary** part, and a take can be
            // several files sharing a takeId (ESCSUITE-14). Every part joins
            // the library; every part that can be placed goes on the
            // timeline, in one undo step — for every take, not only one
            // recorded as separate tracks (decision 7).
            //
            // "Already loaded" is a question about the whole take, so it is
            // asked there rather than here: the parts are not known until the
            // metadata scan, and a take the library holds *any* part of is
            // skipped whole. Read through `getState()` at call time, so the
            // mount-only effect is not answering it from a stale library.
            //
            // This one catches the no-session path. The session path is caught
            // by the second check, in `placePendingTake` — the library here is
            // read before "Restore" has filled it.
            const take = await importTake(videoData, addSourceVideo, (id) =>
              useEditorStore.getState().sourceVideos.some((v) => v.id === id)
            );
            if (cancelled) {
              // This effect is gone: its parts are in the library, and so are
              // their thumbnails — the store owns freeing those (ESCSUITE-113).
              // Revoking them here is what left the take's tiles dead under
              // StrictMode's double mount: the run that replaced this one finds
              // the parts already in the library and mints nothing to replace
              // them with (ESCSUITE-117). The timeline and the toast belong to
              // whoever is still mounted.
              return;
            }
            // Nothing was imported, so there is nothing to place and — as ever
            // for a take already in the library — nothing to say about it.
            if (take.alreadyInLibrary) return;
            pendingTake.current = {
              clipParts: take.clipParts,
              name: videoData.metadata.name,
              missingParts: take.missingParts,
            };
            // Once the question is settled this places the take on the same
            // tick it always did; while it is open this is a no-op and the
            // effect below drains it when the answer lands.
            if (!sessionDecisionPendingRef.current) placePendingTake();
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
    };
  }, []);

  // The session question, answered. Runs on mount too, where it is pending and
  // there is nothing waiting, so this is a no-op both ways round.
  useEffect(() => {
    sessionDecisionPendingRef.current = sessionDecisionPending;
    if (!sessionDecisionPending) placePendingTake();
  }, [sessionDecisionPending, placePendingTake]);
}
