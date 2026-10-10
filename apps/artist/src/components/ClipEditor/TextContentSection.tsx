import { useId } from 'react';
import type { TextAlign, TextOverlayData } from '../../store/types';
import { clampFontSize, withBackgroundAlpha } from './clipColorValues';
import { CollapsibleSection } from './CollapsibleSection';
import type { BurstGestureHandlers } from './useBurstGesture';
import styles from './ClipEditor.module.css';

interface TextContentSectionProps {
  /** The selected text overlay's content and styling. */
  textData: TextOverlayData;
  /** Apply a partial change to that data. */
  onChange: (updates: Partial<TextOverlayData>) => void;
  /**
   * Undo coalescing for the four controls that write on every event — the
   * text, the font size and the two colour pickers (ESCSUITE-242): one typing
   * burst or one picker sweep is one undo entry rather than one per event.
   * Each calls `onEdit` right before its write, and `onBlur` when it loses
   * focus. The bold/italic toggles and the two selects are single changes and
   * do not take part. Optional, so the section renders on its own in a test;
   * without it every write keeps its own entry.
   */
  burstGesture?: BurstGestureHandlers;
  /** Freeze the section's controls — the clip's track is locked (ESCSUITE-84). */
  disabled?: boolean;
}

/**
 * The "Text Content" section of the clip inspector: the text itself, its font
 * family and size, bold/italic/alignment, and the two colours.
 *
 * The textarea grows to fit its content, which it does by writing
 * `style.height` on the element directly — there is no measured height in
 * React state, so a re-render never fights the resize.
 */
export function TextContentSection({ textData, onChange, burstGesture, disabled }: TextContentSectionProps) {
  /**
   * One id for the section (ESCSUITE-89).
   *
   * Five of these controls have no visible label at all — the textarea, the
   * font family, the font size and the alignment dropdown are read from their
   * own contents by a sighted user — so they are named outright. The two
   * swatches do have a word beside them, "Text" and "BG", which became
   * `<label htmlFor>`s; they also carry an `aria-label`, because "Text" is
   * already the textarea's name and "BG" alone does not say it is a colour.
   * Both names keep the visible word — "Text color", "BG color" — because
   * WCAG 2.5.3 wants the name to contain the label, so "Background color"
   * would be a worse name than the abbreviation is.
   *
   * The bold and italic buttons are named "B" and "I" by their own content, as
   * they always were, and gain the `aria-pressed` their `styles.active` class
   * was the only sign of.
   */
  const id = useId();

  return (
    <CollapsibleSection title="Text Content" disabled={disabled}>
      <textarea
        className={styles.textarea}
        aria-label="Text"
        value={textData.text}
        onChange={(e) => {
          burstGesture?.onEdit();
          onChange({ text: e.target.value });
          // Auto-expand: reset height then set to scrollHeight
          const el = e.target;
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
        }}
        onBlur={burstGesture?.onBlur}
        onFocus={(e) => {
          // Expand on focus in case content already exceeds 2 rows
          const el = e.target;
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
        }}
        rows={2}
        placeholder="Enter text..."
      />

      <div className={styles.row}>
        <select
          className={styles.select}
          aria-label="Font family"
          style={{ flex: '1 1 0', width: 'auto' }}
          value={textData.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        >
          <option value="Arial">Arial</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Times New Roman">Times</option>
          <option value="Georgia">Georgia</option>
          <option value="Verdana">Verdana</option>
          <option value="Courier New">Courier</option>
          <option value="Impact">Impact</option>
        </select>
        <input
          type="number"
          className={styles.numberInput}
          value={textData.fontSize}
          onChange={(e) => {
            burstGesture?.onEdit();
            onChange({ fontSize: clampFontSize(e.target.value) });
          }}
          onBlur={burstGesture?.onBlur}
          min={8}
          max={200}
          title="Font size"
          aria-label="Font size"
        />
      </div>

      <div className={styles.row}>
        <button
          className={`${styles.styleButton} ${textData.fontWeight === 'bold' ? styles.active : ''}`}
          onClick={() => onChange({ fontWeight: textData.fontWeight === 'bold' ? 'normal' : 'bold' })}
          aria-pressed={textData.fontWeight === 'bold'}
        >
          B
        </button>
        <button
          className={`${styles.styleButton} ${textData.fontStyle === 'italic' ? styles.active : ''}`}
          onClick={() => onChange({ fontStyle: textData.fontStyle === 'italic' ? 'normal' : 'italic' })}
          aria-pressed={textData.fontStyle === 'italic'}
          style={{ fontStyle: 'italic' }}
        >
          I
        </button>
        <select
          className={styles.select}
          aria-label="Text alignment"
          value={textData.textAlign}
          onChange={(e) => onChange({ textAlign: e.target.value as TextAlign })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <div className={styles.row}>
        <div className={styles.colorInput}>
          <label htmlFor={`${id}-color`}>Text</label>
          <input
            id={`${id}-color`}
            aria-label="Text color"
            type="color"
            value={textData.color}
            onChange={(e) => {
              burstGesture?.onEdit();
              onChange({ color: e.target.value });
            }}
            onBlur={burstGesture?.onBlur}
          />
        </div>
        <div className={styles.colorInput}>
          <label htmlFor={`${id}-background`}>BG</label>
          <input
            id={`${id}-background`}
            aria-label="BG color"
            type="color"
            value={textData.backgroundColor.substring(0, 7)}
            onChange={(e) => {
              burstGesture?.onEdit();
              onChange({ backgroundColor: withBackgroundAlpha(e.target.value) });
            }}
            onBlur={burstGesture?.onBlur}
          />
        </div>
      </div>
    </CollapsibleSection>
  );
}
