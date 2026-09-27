// The "Resume Previous Session?" prompt: looking for a session on startup,
// and the two answers to it.
//
// Its effect is the editor's **second**, so `App` calls this hook fourth —
// after the theme, the toast and the project actions, and before the autosave,
// which gates on the `sessionRestored` flag this hook owns and writes.
//
// `suppressRestore` arrives as a boolean rather than the whole `urlParams`
// object: it is the only field this concern reads, and the dependency the
// effect carried inline was `urlParams.suppressRestore`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessionState, clearSessionState, resolveThumbnailUrl, type SessionState } from '../core/storage';
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

  // Restore session on app start. A saved `thumbnailUrl` is an
  // `URL.createObjectURL` handle from the previous document — dead the moment
  // this one loaded — so every source is rebuilt from its stored thumbnail
  // rather than trusted (ESCSUITE-96). The sources are independent reads, so
  // `Promise.all` runs them together and the store is written once, with
  // every card already showing the right picture rather than a broken one
  // that fixes itself a beat later.
  const handleRestoreSession = useCallback(async (session: SessionState) => {
    if (restoreAttemptRef.current) return; // already restoring — see the ref's own comment
    const attempt = {};
    restoreAttemptRef.current = attempt;

    let sourceVideos: SourceVideo[];
    try {
      sourceVideos = await Promise.all(
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
        // startup lookup leaves it in place (see the effect below).
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
    sourceVideos.forEach(addSourceVideo);
    setCurrentTime(session.currentTime);
    setSelectedClipId(session.selectedClipId);
    setZoom(session.zoom);
    clearHistory();
    setShowSessionPrompt(false);
    setPendingSession(null);
    setSessionRestored(true);
    showNotification('Session restored', 'success');
  }, [setProject, addSourceVideo, setCurrentTime, setSelectedClipId, setZoom, clearHistory, showNotification]);

  const handleDeclineSession = useCallback(() => {
    // Cancel a restore in flight — see restoreAttemptRef's comment above.
    restoreAttemptRef.current = null;
    // Not awaited: the answer lands now whatever storage does about it. The
    // catch is only so a rejection is logged rather than left unhandled.
    clearSessionState().catch(console.error);
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

    const checkSession = async () => {
      try {
        const session = await getSessionState();
        if (session && session.sourceVideos.length > 0) {
          setPendingSession(session);
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
  }, [sessionRestored, suppressRestore]);

  return {
    sessionRestored,
    showSessionPrompt,
    pendingSession,
    handleRestoreSession,
    handleDeclineSession,
  };
}
