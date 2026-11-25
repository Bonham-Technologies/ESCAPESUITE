// What an edit left where it was, in words (ESCSUITE-431). "Remove silences"
// says it in its dialog and its notice; a speed change says it in its notice
// (ESCSUITE-521). One wording, so the two read alike.
import type { LeftBehind } from '../store/rippleRanges';

/** `n` and the noun, singular or plural. */
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the edit leaves where it is: the clips by kind, then the markers.
 * `verb` is "will not move" before the edit, "did not move" after it.
 * `moveEverything` is "Remove silences'" box of that name: with it on, only a
 * lock holds a clip back.
 */
export function leftBehindText(left: LeftBehind, moveEverything: boolean, verb: string): string {
  const kinds = [
    count(left.blur, 'blur', 'blurs'),
    count(left.captions, 'caption', 'captions'),
    count(left.textOrShapes, 'text or shape', 'texts or shapes'),
    count(left.media, 'media clip', 'media clips'),
  ].filter((k) => !k.startsWith('0 '));
  const clips = left.blur + left.captions + left.textOrShapes + left.media;
  // With the box on only a lock holds a clip back: its own track's, or that of
  // a clip it is linked to.
  const where = !moveEverything
    ? 'on other tracks'
    : `on ${clips === 1 ? 'a locked track' : 'locked tracks'}${left.linkedToLocked > 0 ? ' or linked to one' : ''}`;
  const sentences: string[] = [];
  if (clips > 0) {
    sentences.push(`${count(clips, 'clip', 'clips')} ${where} ${verb}: ${kinds.join(', ')}.`);
  }
  if (left.markers > 0) sentences.push(`${count(left.markers, 'marker', 'markers')} ${verb}.`);
  return sentences.join(' ');
}
