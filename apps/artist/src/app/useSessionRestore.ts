// The "Resume Previous Session?" prompt: looking for a session on startup,
// and the two answers to it.
//
// Its effect is the editor's **second**, so `App` calls this hook third —
// after the theme and the toast, and before the autosave,
// which gates on the `sessionRestored` flag this hook owns and writes — and
// whose hold on this tab's own lock must come after this hook's probe of it
// (ESCSUITE-274, `sessionLock.ts`).
//
// It also owns this tab's id (ESCSUITE-274, `tabId.ts`): the autosave writes
// that tab's slot and New Project clears it. The id is state only so a
// duplicated tab can be given a new one; it never changes otherwise.
//
// `suppressRestore` arrives as a boolean rather than the whole `urlParams`
// object: it is the only field this concern reads, and the dependency the
// effect carried inline was `urlParams.suppressRestore`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearSessionState, resolveThumbnailUrl, type SessionState } from '../core/storage';
import { repairEditorBlock } from '../store/projectMigration';
import { applyEditorBlock } from './editorBlock';
import { probeTabLock } from './sessionLock';
import { adoptSessionSlot, findOfferableSlot, type OfferedSlot } from './sessionSlots';
import { readTabId, renewTabId } from './tabId';
import type { Project, SourceVideo } from '../store/types';
import type { ShowNotification } from './useNotification';

/** What the session check and its two answers need from outside. */
export interface SessionRestoreDeps {
  /** `?suppressRestore=1`: the host drives its own state, so do not offer one. */
  suppressRestore: boolean;
  setProject: (project: Project) => void;
  addSourceVideo: (video: SourceVideo) => void;
  setCurrentTime: (time: number) => void;
  setSelectedClipId: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  clearHistory: () => void;
  showNotification: ShowNotification;
}

/** The prompt's state, and the two answers to it. */
export interface SessionRestore {
  /**
   * The startup session question has been settled — restored, declined,
   * suppressed, or nothing found. The autosave gates on it.
   */
  sessionRestored: boolean;
  /** The prompt is up. */
  showSessionPrompt: boolean;
  /** The session the prompt is offering, or `null`. */
  pendingSession: SessionState | null;
  /** This tab's id: the key of its own session slot (ESCSUITE-274). */
  tabId: string;
  handleRestoreSession: (session: SessionState) => Promise<void>;
  handleDeclineSession: () => void;
}

export function useSessionRestore({
  suppressRestore,
  setProject,
  addSourceVideo,
  setCurrentTime,
  setSelectedClipId,
  setZoom,
  clearHistory,
  showNotification,
}: SessionRestoreDeps): SessionRestore {
  const [sessionRestored, setSessionRestored] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [pendingSession, setPendingSession] = useState<SessionState | null>(null);
  // This tab's id, read once per mount (a reload keeps it: `tabId.ts`), and
  // replaced only when the startup check finds it held by a live tab.
  const [tabId, setTabId] = useState(readTabId);
  // The slot the prompt is offering: declining deletes it, restoring adopts
  // it. A ref, not state — `pendingSession` already renders the prompt, and
  // the two answers read this only when they run. It carries the release for
  // the departed tab's lock this tab claimed while the slot is on offer
  // (ESCSUITE-283): every way the prompt closes lets go of it, and a tab that
  // dies with the prompt up lets go of it with its page.
  const offeredSlotRef = useRef<OfferedSlot | null>(null);

  // Which restore is still allowed to land, or none. Set at the top of
  // `handleRestoreSession`, checked again after its `await` settles — either
  // resolved or rejected. A restore reads every thumbnail before it commits
  // anything (ESCSUITE-96), and that read is exactly the window in which the
  // user can click "Start Fresh", or click "Restore Session" again, or the
  // read itself can fail:
  // - a truthy ref at entry means a restore is already in flight, so a second
  //   call (a double click, a repeated Enter) is a no-op rather than a second
  //   pass of `addSourceVideo` over the same sources;
  // - `handleDeclineSession` clears it, so a restore already past that guard
  //   finds it changed when its reads come back and does not commit — the
  //   decline it lost the race to already ran `clearSessionState()` and
  //   closed the prompt, and a restore that lands anyway would silently
  //   undo the user's answer;
  // - a rejected read clears it itself (in the `catch` below), so a restore
  //   that cannot go on does not leave every later attempt permanently
  //   blocked on a token nothing will ever match again.
  const restoreAttemptRef = useRef<object | null>(null);

  // The startup check has been started. StrictMode runs the effect below
  // twice on one instance (refs survive its cleanup-then-remount), and the
  // second run's probe of this tab's own lock would find the first one's
  // momentary hold and call this tab a duplicate of itself (ESCSUITE-227,
  // ESCSUITE-274).
  const checkStartedRef = useRef(false);

  // Restore session on app start. A saved `thumbnailUrl` is an
  // `URL.createObjectURL` handle from the previous document — dead the moment
  // this one loaded — so every source is rebuilt from its stored thumbnail
  // rather than trusted (ESCSUITE-96). The sources are independent reads, so
  // `Promise.all` runs them together and the store is written once, with
  // every card already showing the right picture rather than a broken one
  // that fixes itself a beat later.
  //
  // This does not revoke anything on its own: the library is not
  // reliably empty here — the CRAFT handoff adds a take's parts to it as
  // soon as it arrives, well before the placement that waits on this
  // question settling — so a blanket revoke of "whatever is here" would
  // kill the handoff's still-live thumbnails too. `addSourceVideo`
  // (`store/projectSlice.ts`) is the one place that owns freeing a
  // replaced source's *old* thumbnailUrl, exactly when a restored source
  // happens to share an id the handoff already added (ESCSUITE-113).
  const handleRestoreSession = useCallback(async (session: SessionState) => {
    if (restoreAttemptRef.current) return; // already restoring — see the ref's own comment
    const attempt = {};
    restoreAttemptRef.current = attempt;

    let restoredSourceVideos: SourceVideo[];
    try {
      restoredSourceVideos = await Promise.all(
        session.sourceVideos.map(async (video) => ({
          ...video,
          thumbnailUrl: await resolveThumbnailUrl(video.id),
        }))
      );
    } catch (error) {
      console.error('Failed to restore session:', error);
      // Only settle the question if nobody declined while we were reading —
      // a decline already ran this exact landing (fresh project, question
      // settled) and there is nothing this failure should add to it beyond
      // the log line above.
      if (restoreAttemptRef.current === attempt) {
        restoreAttemptRef.current = null;
        // The saved session is left in storage — this was not the user's
        // answer, so a reload should still offer it, the same way a failed
        // startup lookup leaves it in place (see the effect below) — and the
        // claim on it is let go, so another tab may offer it too (ESCSUITE-283).
        offeredSlotRef.current!.release();
        setShowSessionPrompt(false);
        setPendingSession(null);
        setSessionRestored(true);
        showNotification('Failed to restore session', 'error');
      }
      return;
    }

    // Declined while the reads were in flight: that answer already ran and
    // closed the prompt, so this restore must not override it.
    if (restoreAttemptRef.current !== attempt) return;

    setProject(session.project);
    restoredSourceVideos.forEach(addSourceVideo);
    setCurrentTime(session.currentTime);
    setSelectedClipId(session.selectedClipId);
    setZoom(session.zoom);
    // ESCSUITE-245: the app's own autosave is repaired, not refused — a block
    // that fails the file's checks falls back to no range and no markers with
    // one warning, and an old snapshot with no block clears whatever the
    // editor held. Neither is an edit, so neither is undoable.
    applyEditorBlock(repairEditorBlock(session.editor, session.project.timeline.clips));
    clearHistory();
    // Another tab's slot — one that closed or crashed, or the legacy shared
    // row — becomes this tab's (ESCSUITE-274). Not awaited: the restore has
    // landed, and the adoption logs its own failure (it never rejects). The
    // departed tab's lock is let go once the old row is gone, so no other tab
    // is offered it on its way out (ESCSUITE-283). This tab's own slot (a
    // reload) is already where it belongs, and claimed nothing.
    const offered = offeredSlotRef.current!;
    if (offered.slot.tabId !== tabId) void adoptSessionSlot(offered.slot, tabId).then(offered.release);
    setShowSessionPrompt(false);
    setPendingSession(null);
    setSessionRestored(true);
    showNotification('Session restored', 'success');
  }, [setProject, addSourceVideo, setCurrentTime, setSelectedClipId, setZoom, clearHistory, showNotification, tabId]);

  const handleDeclineSession = useCallback(() => {
    // Cancel a restore in flight — see restoreAttemptRef's comment above.
    restoreAttemptRef.current = null;
    // Not awaited: the answer lands now whatever storage does about it. The
    // catch is only so a rejection is logged rather than left unhandled. The
    // slot deleted is the one offered, whichever tab's it was (ESCSUITE-274),
    // and the departed tab's lock is let go once the delete settles either
    // way (ESCSUITE-283).
    const offered = offeredSlotRef.current!;
    clearSessionState(offered.slot.tabId).catch(console.error).then(offered.release);
    setShowSessionPrompt(false);
    setPendingSession(null);
    setSessionRestored(true);
  }, []);

  // Check for saved session on mount
  useEffect(() => {
    if (sessionRestored) return;

    // A host that drives its own state can suppress the prompt with
    // ?suppressRestore=1. The saved session is deliberately left in storage.
    if (suppressRestore) {
      setSessionRestored(true);
      return;
    }

    if (checkStartedRef.current) return;
    checkStartedRef.current = true;

    const checkSession = async () => {
      try {
        // Requested synchronously, before this function's first await, so the
        // probe is queued ahead of this tab's own hold on its lock — the
        // autosave's effect, which runs after this one (see `sessionLock.ts`).
        let ownId = tabId;
        if ((await probeTabLock(ownId)) === 'held') {
          // A live tab already has this id: this tab is a duplicate of it,
          // started with a copy of its sessionStorage. It takes an id of its
          // own, so it neither writes over that tab's slot nor is offered it.
          ownId = renewTabId();
          setTabId(ownId);
        }
        const offered = await findOfferableSlot(ownId, Date.now());
        if (offered) {
          offeredSlotRef.current = offered;
          setPendingSession(offered.slot.session);
          setShowSessionPrompt(true);
        } else {
          setSessionRestored(true);
        }
      } catch (error) {
        console.error('Failed to check session:', error);
        setSessionRestored(true);
      }
    };

    checkSession();
  }, [sessionRestored, suppressRestore, tabId]);

  return {
    sessionRestored,
    showSessionPrompt,
    pendingSession,
    tabId,
    handleRestoreSession,
    handleDeclineSession,
  };
}
