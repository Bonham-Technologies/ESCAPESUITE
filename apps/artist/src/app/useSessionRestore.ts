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
import {
  clearSessionState,
  getVideo,
  resolveThumbnailUrl,
  revokeSourceThumbnails,
  type SessionState,
} from '../core/storage';
import { repairEditorBlockForProject } from '../store/projectMigration';
import { timelineWithoutSources } from '../store/projectFactory';
import { sessionSourcesLeftOutMessage } from './appFormat';
import { applyEditorBlock } from './editorBlock';
import { probeTabLock } from './sessionLock';
import { rememberDeclinedSlot } from './declinedSlots';
import {
  adoptSessionSlot,
  findOfferableSlot,
  slotAtAnswer,
  type OfferedSlot,
  type SlotAtAnswer,
} from './sessionSlots';
import { readTabId, renewTabId } from './tabId';
import type { Project, SourceVideo } from '../store/types';
import type { ShowNotification } from './useNotification';

/** What the session check and its two answers need from outside. */
export interface SessionRestoreDeps {
  /** `?suppressRestore=1`: the host drives its own state, so do not offer one. */
  suppressRestore: boolean;
  setProject: (project: Project) => void;
  addSourceVideo: (video: SourceVideo) => void;
  /** Puts the playhead back where the session left it: a seek (ESCSUITE-287). */
  seekTo: (time: number) => void;
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

/** Why a restore of a stale offer is refused (ESCSUITE-283); logged, never shown. */
const OWNER_RETURNED = 'The tab that saved this session is open again';

// What the prompt says when its slot has moved on since it was offered
// (ESCSUITE-289): saved again by its tab, which came back and closed again, or
// removed. Each is shown once, on the answer that found it.
/** Restore found a newer save: the prompt now offers that one. */
export const SESSION_NEWER_NOTICE = 'That session changed in another window — here is the newer one.';
/**
 * Start Fresh found a newer save: it was not deleted. It stays in storage and is
 * offered like any other departed tab's slot — not necessarily to this tab,
 * whose own slot comes first on a reload.
 */
export const SESSION_KEPT_NOTICE = 'That session was changed in another window, so it was not deleted.';
/** Either answer found the slot gone: nothing to delete or adopt. */
export const SESSION_REMOVED_NOTICE = 'That session was removed in another window.';

/**
 * A restored source whose bytes are no longer in storage (ESCSUITE-307): the
 * row was deleted after the session was saved — by a storage clear in another
 * tab, by ESCAPECRAFT, or by a clear in this tab before ESCSUITE-307 made the
 * clears empty the slot. Restoring it would put a tile in the library that
 * nothing can play, place or export (the ESCSUITE-149/154 defect).
 */
interface RestoredSource {
  video: SourceVideo;
  inStorage: boolean;
}

export function useSessionRestore({
  suppressRestore,
  setProject,
  addSourceVideo,
  seekTo,
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
  // The slot the prompt is offering: declining deletes it if it is this tab's
  // own or the legacy row (and otherwise leaves it, ESCSUITE-306), restoring
  // adopts it. A ref, not state — `pendingSession` already renders the prompt, and
  // the two answers read this only when they run. It carries the release for
  // the offer lock this tab claimed while the slot is on offer (ESCSUITE-283):
  // every way the prompt closes lets go of it — except a restore whose
  // adoption failed, which keeps it while the old row is still in storage —
  // and a tab that dies with the prompt up lets go of it with its page. It
  // also carries `ownerReturned`, which both answers ask first: the departed
  // tab may have come back while the prompt was up and been offered its own
  // slot, and the offer here is then stale.
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
  //   decline it lost the race to already answered the slot and closed the
  //   prompt, and a restore that lands anyway would silently
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
    const offered = offeredSlotRef.current!;

    // Every thumbnail handle the reads below minted, once they have all
    // settled — so a failure anywhere after that point (a rejected read, the
    // owner back, ESCSUITE-283; a re-read that fails, ESCSUITE-289) frees each
    // of them in the catch. Empty only while the reads are still in flight,
    // and nothing can throw then: every read is settled, never raced.
    let restoredSourceVideos: SourceVideo[] = [];
    // The ids whose bytes are gone (ESCSUITE-307): left out of the restore,
    // with every clip that plays one, and counted in its one notice.
    let leftOutIds: Set<string>;
    let atAnswer: SlotAtAnswer;
    try {
      // Each source's stored thumbnail and its row, read together and each
      // allowed to settle: a rejected read must not leave a sibling's read in
      // flight to mint a handle nobody frees (ESCSUITE-307 review round 1).
      const reads = await Promise.all(
        session.sourceVideos.map(async (video) => {
          const [thumbnail, stored] = await Promise.allSettled([resolveThumbnailUrl(video.id), getVideo(video.id)]);
          return { video, thumbnail, stored };
        })
      );
      restoredSourceVideos = reads.flatMap(({ video, thumbnail }) =>
        thumbnail.status === 'fulfilled' ? [{ ...video, thumbnailUrl: thumbnail.value }] : []
      );
      // A read that rejected fails the restore — a row read that fails is not
      // a row that is gone. Otherwise a source whose row is gone is dropped,
      // and the thumbnail just minted for it is freed at once.
      const restored: RestoredSource[] = reads.map(({ video, thumbnail, stored }) => {
        if (thumbnail.status === 'rejected') throw thumbnail.reason;
        if (stored.status === 'rejected') throw stored.reason;
        return { video: { ...video, thumbnailUrl: thumbnail.value }, inStorage: stored.value !== undefined };
      });
      restoredSourceVideos = restored.filter((r) => r.inStorage).map((r) => r.video);
      const leftOut = restored.filter((r) => !r.inStorage).map((r) => r.video);
      revokeSourceThumbnails(leftOut);
      leftOutIds = new Set(leftOut.map((v) => v.id));
      // A stale offer (ESCSUITE-283): the tab that wrote this slot is open
      // again and has been offered it itself. Adopting it would take its work
      // out from under it, so this is refused the way a failed read is. An
      // owner that comes back after this check and before the adoption below
      // still has its slot adopted — two copies, never a loss (a documented
      // limit; see apps/artist/CLAUDE.md, "The limits this leaves").
      if (await offered.ownerReturned()) throw new Error(OWNER_RETURNED);
      // A slot saved again or removed since it was offered (ESCSUITE-289): read
      // last, as close to the commit as it can be. A read that fails is a failed
      // restore, below. A save landing between this read and the adoption is
      // still adopted over — a documented limit, as for the owner check above.
      atAnswer = await slotAtAnswer(offered.slot);
    } catch (error) {
      console.error('Failed to restore session:', error);
      // Nothing read here is ever shown: free the thumbnails it minted.
      revokeSourceThumbnails(restoredSourceVideos);
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
        offered.release();
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

    if (atAnswer !== 'unchanged') {
      // The prompt was offering a save that is no longer there (ESCSUITE-289).
      // Nothing is adopted, and the thumbnails just read for it are freed.
      restoreAttemptRef.current = null;
      revokeSourceThumbnails(restoredSourceVideos);
      if (atAnswer === 'removed') {
        // Nothing left to restore: the prompt closes, the way a failed restore's does.
        offered.release();
        setShowSessionPrompt(false);
        setPendingSession(null);
        setSessionRestored(true);
        showNotification(SESSION_REMOVED_NOTICE, 'info');
      } else {
        // Saved again by its tab since the offer. The owner probe above ran
        // before this re-read, so a tab that came back between the two is
        // re-offered while it is live — and the next answer's probe refuses it
        // then. The prompt is re-offered in place from the newer save and stays
        // up, under the same offer claim rather than one let go and claimed
        // again: a release followed at once by an `ifAvailable` request for the
        // same lock can find it not yet let go and offer nothing. (It is not a
        // fresh `findOfferableSlot` run, so a slot another tab has left since,
        // newer still, is not considered, and the media check is not repeated.)
        offeredSlotRef.current = { ...offered, slot: atAnswer };
        setPendingSession(atAnswer.session);
        showNotification(SESSION_NEWER_NOTICE, 'info');
      }
      return;
    }

    // A source whose bytes are gone takes its clips with it (ESCSUITE-307),
    // the way a storage clear does — the same arithmetic, so the duration is
    // recalculated the same way — and a selection naming one of those clips
    // goes too, rather than being restored as a ghost (ESCSUITE-101). Nothing
    // left out: the saved project and selection exactly as they were.
    let project = session.project;
    let selectedClipId = session.selectedClipId;
    if (leftOutIds.size > 0) {
      project = { ...session.project, timeline: timelineWithoutSources(session.project.timeline, leftOutIds) };
      if (!project.timeline.clips.some((c) => c.id === selectedClipId)) selectedClipId = null;
    }
    setProject(project);
    restoredSourceVideos.forEach(addSourceVideo);
    seekTo(session.currentTime);
    setSelectedClipId(selectedClipId);
    setZoom(session.zoom);
    // ESCSUITE-245: the app's own autosave is repaired, not refused — a block
    // that fails the file's checks falls back to no range and no markers with
    // one warning, and an old snapshot with no block clears whatever the
    // editor held. Neither is an edit, so neither is undoable.
    applyEditorBlock(repairEditorBlockForProject(session.editor, project));
    clearHistory();
    // Another tab's slot — one that closed or crashed, or the legacy shared
    // row — becomes this tab's (ESCSUITE-274). Not awaited: the restore has
    // landed, and the adoption logs its own failure (it never rejects). The
    // offer is let go once the old row is gone, so no other tab is offered it
    // on its way out — and kept if the adoption failed and the row is still
    // there, so no other tab adopts a second copy of it (ESCSUITE-283). This
    // tab's own slot (a reload) is already where it belongs, and claimed nothing.
    if (offered.slot.tabId !== tabId) {
      void adoptSessionSlot(offered.slot, tabId).then((adopted) => {
        if (adopted) offered.release();
      });
    }
    setShowSessionPrompt(false);
    setPendingSession(null);
    setSessionRestored(true);
    // One toast slot: a restore that left files out says so instead of
    // reporting a clean success (ESCSUITE-14's "missing part skipped" shape) —
    // and says so even when it left out everything and restored an empty project.
    if (leftOutIds.size > 0) showNotification(sessionSourcesLeftOutMessage(leftOutIds.size), 'info');
    else showNotification('Session restored', 'success');
  }, [setProject, addSourceVideo, seekTo, setSelectedClipId, setZoom, clearHistory, showNotification, tabId]);

  const handleDeclineSession = useCallback(() => {
    // Cancel a restore in flight — see restoreAttemptRef's comment above.
    restoreAttemptRef.current = null;
    // Not awaited: the answer lands now whatever storage does about it. The
    // catch is only so a rejection is logged rather than left unhandled.
    //
    // Only this tab's own slot (a reload) and the ownerless legacy row are
    // deleted. Another tab's slot is left in storage and the save declined is
    // remembered, so this tab does not offer that save again — a newer one from
    // the same tab it does (ESCSUITE-306): a free tab lock is not
    // proof that tab is gone — Chrome's Memory Saver discards a background tab,
    // freeing its lock while the tab keeps its sessionStorage and id, and it
    // reloads looking for its own slot. The 30-day prune is what removes a slot
    // whose tab never returns.
    //
    // Before any of that: if the slot's tab has come back while the prompt was
    // up (ESCSUITE-283), the slot is a live tab's work again and is left alone;
    // and the slot is read again (ESCSUITE-289) — its tab may have come back,
    // saved newer work into it and closed again, or removed it. A newer save is
    // kept and offered again on the next startup; a removed one leaves nothing
    // to answer. Either is said once. A re-read that fails deletes nothing, the
    // safe side, and is logged. The offer is let go once all this settles.
    const offered = offeredSlotRef.current!;
    offered
      .ownerReturned()
      .then(async (returned) => {
        if (returned) return;
        const atAnswer = await slotAtAnswer(offered.slot);
        if (atAnswer !== 'unchanged') {
          showNotification(atAnswer === 'removed' ? SESSION_REMOVED_NOTICE : SESSION_KEPT_NOTICE, 'info');
          return;
        }
        const owner = offered.slot.tabId;
        if (owner === null || owner === tabId) return clearSessionState(owner);
        rememberDeclinedSlot({ tabId: owner, timestamp: offered.slot.session.timestamp });
      })
      .catch(console.error)
      .then(offered.release);
    setShowSessionPrompt(false);
    setPendingSession(null);
    setSessionRestored(true);
  }, [showNotification, tabId]);

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
