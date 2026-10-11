// The debounced session autosave.
//
// Its effects are the editor's **third** (the debounce) and **fourth** (the
// hold on this tab's own lock, ESCSUITE-274), so `App` calls this hook fourth —
// immediately after `useSessionRestore`, whose `sessionRestored` flag gates it
// and whose `tabId` names the slot it writes. Registering it any earlier would
// change which render first arms the debounce, and would queue this tab for
// its own lock before the restore check had asked whether a live tab already
// holds this id (see `sessionLock.ts`). `useProjectActions` comes right after
// it, because New Project calls `clearSession`.
//
// `suppressRestore` arrives as a boolean for the same reason it does in
// `useSessionRestore`: `urlParams.suppressRestore` was the inline dependency.
import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../store/projectStore';
import { clearSessionState, saveSessionState, type SessionState } from '../core/storage';
import { AUTO_SAVE_DELAY } from './appConstants';
import { buildSessionSnapshot, isEmptySession } from './sessionSnapshot';
import { holdTabLock } from './sessionLock';
import type { Project, SourceVideo } from '../store/types';
import type { ShowNotification } from './useNotification';

/**
 * The same sentence `components/VideoUploader.tsx` already shows for a quota
 * failure on import — kept verbatim so a quota error reads the same way
 * wherever ESCAPEARTIST hits it.
 */
export const AUTOSAVE_QUOTA_NOTICE =
  'Storage quota exceeded. Remove some media to free up space.';

/** What the autosave says when the rejection is not a quota error at all. */
export const AUTOSAVE_GENERIC_NOTICE = 'Your session could not be saved — storage may be full.';

/**
 * The DOMException name behind a rejected session write, the same shape
 * ESCAPECRAFT's `failureName` reads (ESCSUITE-210,
 * `hooks/useRecordingController.ts`): a caller that wants to attach more
 * context reaches for `new Error('…', { cause })`, carrying the browser's own
 * `DOMException` — and its real name — as `cause`, while a rejection
 * `saveSessionState` can hit directly (the e2e quota mock, `idb`'s own
 * rejections) is a bare `DOMException` with no wrapper at all. Reading
 * `error.cause ?? error` covers both; the error itself is read when it is
 * not wrapped, or when the rejection is not an object at all (nothing today
 * rejects with a bare value, but the optional chain holds rather than
 * crashing if something ever does).
 */
function failureName(error: unknown): string | undefined {
  const err = error as { name?: string; cause?: unknown } | null | undefined;
  return ((err?.cause ?? err) as { name?: string } | null | undefined)?.name;
}

/**
 * What the editor's notice says about a rejected autosave: the media
 * library's own quota sentence when the browser's error says
 * `QuotaExceededError`, the generic one for anything else — a session write
 * can fail for reasons a quota check cannot name.
 */
export function autosaveFailureNotice(error: unknown): string {
  return failureName(error) === 'QuotaExceededError' ? AUTOSAVE_QUOTA_NOTICE : AUTOSAVE_GENERIC_NOTICE;
}

/** What re-arms the autosave, and what switches it off. */
export interface SessionAutosaveDeps {
  /** The startup session question has been settled; nothing is written before it is. */
  sessionRestored: boolean;
  /** `?suppressRestore=1`: the host drives its own state, so write nothing. */
  suppressRestore: boolean;
  /** This tab's id (`useSessionRestore`): the slot written is `session:<tabId>`. */
  tabId: string;
  project: Project;
  sourceVideos: SourceVideo[];
  selectedClipId: string | null;
  zoom: number;
  /** Raised once, not on every failed tick, while writes keep failing. */
  showNotification: ShowNotification;
}

/** What the autosave tells the rest of the editor. */
export interface SessionAutosave {
  /**
   * Empty this tab's own slot, and no other tab's (ESCSUITE-274) — New
   * Project's. A no-op under `?suppressRestore=1`, where the editor writes
   * nothing to storage at all.
   */
  clearSession: () => void;
}

export function useSessionAutosave({
  sessionRestored,
  suppressRestore,
  tabId,
  project,
  sourceVideos,
  selectedClipId,
  zoom,
  showNotification,
}: SessionAutosaveDeps): SessionAutosave {
  // The latch: raised the moment a write first fails, so a run of failing
  // ticks reports once rather than once per tick. It clears on the next
  // SUCCESSFUL write, so a later failure — a fresh run, not the same one —
  // is reported again. A ref, not state: it must survive the effect
  // re-running on every edit (the dependency array below) without itself
  // causing a render.
  const hasReportedFailureRef = useRef(false);

  // Auto-save session on state changes (debounced)
  //
  // `currentTime` re-arms the debounce but is deliberately NOT a dependency:
  // playback writes it every ~200 ms, and a dependency would re-render App —
  // and with it the whole timeline — on every tick. A store subscription gets
  // the same re-arming without the render, so the behaviour is unchanged: while
  // the playhead is moving the timer never elapses, and the session is written
  // AUTO_SAVE_DELAY after it settles. The payload is read at fire time rather
  // than closed over, so it is always the latest state.
  useEffect(() => {
    if (!sessionRestored) return;

    // ?suppressRestore=1 means the host drives its own state: ESCAPEARTIST
    // neither offers the saved session nor writes over it.
    if (suppressRestore) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const arm = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const state = useEditorStore.getState();
        // This tab's own slot (ESCSUITE-274): no other tab writes it, so a
        // tab that crashes keeps its session however long another edits.
        const session: SessionState = buildSessionSnapshot(state, Date.now(), tabId);
        // An empty project never overwrites the slot — Start Fresh and New
        // Project's own clears are the ways a slot is emptied on purpose.
        if (isEmptySession(session)) return;
        saveSessionState(session).then(
          () => {
            hasReportedFailureRef.current = false;
          },
          (error: unknown) => {
            console.error(error);
            if (!hasReportedFailureRef.current) {
              hasReportedFailureRef.current = true;
              showNotification(autosaveFailureNotice(error), 'error');
            }
          }
        );
      }, AUTO_SAVE_DELAY);
    };

    arm();
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      // The playhead, and the in/out points and markers (ESCSUITE-245): none
      // is an effect dependency, so none re-renders App, but each is part of
      // what gets written and should re-arm the debounce all the same.
      if (
        state.currentTime !== previous.currentTime ||
        state.inPoint !== previous.inPoint ||
        state.outPoint !== previous.outPoint ||
        state.markers !== previous.markers
      ) arm();
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [sessionRestored, suppressRestore, tabId, project, sourceVideos, selectedClipId, zoom, showNotification]);

  // Hold this tab's lock for the life of the editor (ESCSUITE-274): it is how
  // a later tab's startup check tells that this tab's slot is live work and
  // not a session to offer. Registered after the debounce, and — the part that
  // matters — after `useSessionRestore`'s startup check, whose probe of this
  // same id must be requested first or it would answer "held" against this
  // tab. Re-held under the new id when a duplicated tab is given one. A
  // host-driven editor (`?suppressRestore=1`) writes no slot, so it holds none.
  useEffect(() => {
    if (suppressRestore) return;
    return holdTabLock(tabId);
  }, [suppressRestore, tabId]);

  const clearSession = useCallback(() => {
    if (suppressRestore) return;
    // Not awaited: New Project lands now whatever storage does about it.
    clearSessionState(tabId).catch(console.error);
  }, [suppressRestore, tabId]);

  return { clearSession };
}
