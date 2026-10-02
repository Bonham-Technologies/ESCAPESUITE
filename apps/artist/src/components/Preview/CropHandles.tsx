// The eight crop handles, as DOM buttons over the preview canvas
// (ESCSUITE-157).
//
// A SHELL for now: Task 3 mounts this layer and pins that it is mounted exactly
// when `cropTarget` says crop mode is on, and Task 4 fills the body in — the
// positioned group, the eight named buttons and the drag. The props are Task
// 4's own and do not change.
import type { Clip, SourceVideo } from '../../store/types';
import type { ProjectSize } from './types';

export interface CropHandlesProps {
  clip: Clip;
  source: SourceVideo;
  canvas: HTMLCanvasElement;
  projectSize: ProjectSize;
  /** The playhead, so the handles sit on the clip's animated box. */
  time: number;
  locked: boolean;
  onLeave: () => void;
}

export function CropHandles(_props: CropHandlesProps) {
  return null;
}
