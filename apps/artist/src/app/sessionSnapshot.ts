// The autosave payload: what of the editor's state gets written to
// session storage, and in what shape.
//
// Pure: takes the store's state and a timestamp as plain values, rather than
// reading `useEditorStore.getState()` or `Date.now()` itself, so the call
// site keeps control of *when* those are read while the shape of the
// snapshot is tested without a store.
import type { EditorState, SourceVideo } from '../store/types';
import type { SessionState } from '../core/storage';

// `thumbnailUrl` is only ever an `URL.createObjectURL` handle
// (videoProcessor.ts, takeImport.ts) — it dies with the document, so writing
// it here would persist a handle nothing can ever open again. Restoring it is
// `useSessionRestore.handleRestoreSession`'s job, rebuilt from the stored
// thumbnail blob (ESCSUITE-96). Returns the same object when there is nothing
// to strip, so a library with no thumbnails costs this pass nothing.
function stripThumbnailUrl(video: SourceVideo): SourceVideo {
  if (video.thumbnailUrl === undefined) return video;
  const { thumbnailUrl: _thumbnailUrl, ...rest } = video;
  return rest;
}

/** Build the session snapshot autosave persists, at `timestamp`. */
export function buildSessionSnapshot(state: EditorState, timestamp: number): SessionState {
  return {
    project: state.project,
    sourceVideos: state.sourceVideos.map(stripThumbnailUrl),
    currentTime: state.currentTime,
    selectedClipId: state.selectedClipId,
    zoom: state.zoom,
    editor: { inPoint: state.inPoint, outPoint: state.outPoint, markers: state.markers },
    timestamp,
  };
}

/**
 * The snapshot holds no work at all: no source in the library and no clip on
 * the timeline (ESCSUITE-227). The autosave never writes such a snapshot, so a
 * tab with nothing in it — a second tab, a tab that pressed Start Fresh — can
 * never overwrite a slot that holds someone's work. A clip with no source (a
 * text overlay) is work, and so is a source with no clip.
 */
export function isEmptySession(session: SessionState): boolean {
  return session.sourceVideos.length === 0 && session.project.timeline.clips.length === 0;
}
