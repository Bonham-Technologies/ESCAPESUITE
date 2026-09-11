// Which transition, if any, the playhead is inside — and the two clips it runs
// between.
//
// The preview and the export pipeline must agree on this exactly: a transition
// that picks a different incoming clip on screen than it does in the rendered
// file is a bug the editor cannot show you. So there is one implementation, the
// exporter's, and the preview draws through it.
export { getActiveTransition, type TransitionInfo } from '../../core/exportTypes';
