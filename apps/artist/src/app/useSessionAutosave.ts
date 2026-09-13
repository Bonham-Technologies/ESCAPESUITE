// The debounced session autosave.
//
// Its effect is the editor's **third**, so `App` calls this hook fifth —
// immediately after `useSessionRestore`, whose `sessionRestored` flag gates it.
// Registering it any earlier would change which render first arms the debounce.
//
// `suppressRestore` arrives as a boolean for the same reason it does in
// `useSessionRestore`: `urlParams.suppressRestore` was the inline dependency.
import { useEffect } from 'react';
import { useEditorStore } from '../store/projectStore';
import { saveSessionState, type SessionState } from '../core/storage';
import { AUTO_SAVE_DELAY } from './appConstants';
import { buildSessionSnapshot } from './sessionSnapshot';
import type { Project, SourceVideo } from '../store/types';

/** What re-arms the autosave, and what switches it off. */
export interface SessionAutosaveDeps {
  /** The startup session question has been settled; nothing is written before it is. */
  sessionRestored: boolean;
  /** `?suppressRestore=1`: the host drives its own state, so write nothing. */
  suppressRestore: boolean;
  project: Project;
  sourceVideos: SourceVideo[];
  selectedClipId: string | null;
  zoom: number;
}

export function useSessionAutosave({
  sessionRestored,
  suppressRestore,
  project,
  sourceVideos,
  selectedClipId,
  zoom,
}: SessionAutosaveDeps): void {
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
        const session: SessionState = buildSessionSnapshot(state, Date.now());
        saveSessionState(session).catch(console.error);
      }, AUTO_SAVE_DELAY);
    };

    arm();
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) arm();
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [sessionRestored, suppressRestore, project, sourceVideos, selectedClipId, zoom]);
}
