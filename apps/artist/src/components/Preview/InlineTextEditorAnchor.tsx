// Where the inline text editor sits.
//
// The textarea is a DOM element over the preview, but the text it replaces is
// canvas pixels inside a canvas the browser has letterboxed to fit its box.
// This works out the one from the other: the clip's bounds in canvas pixels,
// then the object-fit: contain mapping into the element's own coordinates, so
// the editor lands on the text rather than beside it.
import type { Clip, SourceVideo } from '../../store/types';
import { contentBox, getOverlayBounds } from './previewGeometry';
import { InlineTextEditor } from './InlineTextEditor';

/**
 * Text bounds are measured, not derived from a source's dimensions, so the
 * media branch of getOverlayBounds — the only part that reads this — is never
 * reached from here.
 */
const NO_SOURCES: SourceVideo[] = [];

export interface InlineTextEditorAnchorProps {
  /** The text clip being edited; anything else renders no editor. */
  clip: Clip | undefined;
  /** The preview canvas, for its pixel size, its layout box and its text metrics. */
  canvas: HTMLCanvasElement;
  onCommit: (newText: string) => void;
  onCancel: () => void;
}

/** Position an InlineTextEditor over the text clip it is editing. */
export function InlineTextEditorAnchor({
  clip,
  canvas,
  onCommit,
  onCancel,
}: InlineTextEditorAnchorProps) {
  const textData = clip?.textData;
  if (!clip || !textData) return null;

  // The box the text occupies in canvas pixels. Deliberately un-animated: the
  // editor takes over the clip's stored text, and its keyframes are not
  // applied to the box the textarea covers.
  const bounds = getOverlayBounds(clip, canvas, undefined, NO_SOURCES);
  if (!bounds) return null;

  // The rendered canvas area within the element (object-fit: contain)
  const content = contentBox(canvas);

  // The bounds are centred; the editor is positioned from its top left corner.
  const textLeft = bounds.centerX - bounds.width / 2;
  const textTop = bounds.centerY - bounds.height / 2;

  // Convert to screen-space relative to videoWrapper
  const screenX = content.offsetX + textLeft * content.scaleX;
  const screenY = content.offsetY + textTop * content.scaleY;
  const screenFontSize = textData.fontSize * (textData.scale ?? 1) * content.scaleY;

  return (
    <InlineTextEditor
      clipId={clip.id}
      text={textData.text}
      x={screenX}
      y={screenY}
      fontFamily={textData.fontFamily}
      fontSize={screenFontSize}
      fontWeight={textData.fontWeight}
      fontStyle={textData.fontStyle}
      color={textData.color}
      textAlign={textData.textAlign}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}
