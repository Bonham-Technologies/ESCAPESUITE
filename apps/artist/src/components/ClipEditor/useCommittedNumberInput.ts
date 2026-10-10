// A number field that commits on blur or Enter rather than on every keystroke
// (ESCSUITE-256).
//
// The font-size field used to clamp and write on each keystroke, so typing "24"
// wrote 2 (clamped up to 8) and then 84; "1e2" parsed as 1 and 5000 slipped
// past `max`. A person typing a number is composing a string, not producing a
// series of numbers, so the string is held here and only turned into a number
// when they are done: the blur, or Enter. Escape drops it.
//
// While no draft is held the field shows `value`, so a change from elsewhere
// (undo, another control) shows immediately and a committed write comes back
// through the same path. The only state is the draft itself — a local render
// per keystroke, no store subscription — so `ClipEditor.rerender.test.tsx`
// counts are unaffected.
import { useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

interface CommittedNumberInputOptions {
  /** The stored number the field mirrors. */
  value: number;
  min: number;
  max: number;
  /** Round the committed number to a whole number (an integer-valued field). */
  integer?: boolean;
  /** Called with the clamped number, and only when it differs from `value`. */
  onCommit: (value: number) => void;
}

export interface CommittedNumberInput {
  text: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function useCommittedNumberInput({
  value,
  min,
  max,
  integer,
  onCommit,
}: CommittedNumberInputOptions): CommittedNumberInput {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    // `Number('')` is 0, which is not what an emptied field means.
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed));
    if (clamped !== value) onCommit(clamped);
  };

  return {
    text: draft ?? String(value),
    onChange: (event) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event) => {
      if (event.key === 'Enter') commit();
      else if (event.key === 'Escape') setDraft(null);
    },
  };
}
