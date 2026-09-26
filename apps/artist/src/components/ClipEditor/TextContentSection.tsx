import type { TextAlign, TextOverlayData } from '../../store/types';
import { clampFontSize, withBackgroundAlpha } from './clipColorValues';
import { CollapsibleSection } from './CollapsibleSection';
import styles from './ClipEditor.module.css';

interface TextContentSectionProps {
  /** The selected text overlay's content and styling. */
  textData: TextOverlayData;
  /** Apply a partial change to that data. */
  onChange: (updates: Partial<TextOverlayData>) => void;
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
export function TextContentSection({ textData, onChange, disabled }: TextContentSectionProps) {
  return (
    <CollapsibleSection title="Text Content" disabled={disabled}>
      <textarea
        className={styles.textarea}
        value={textData.text}
        onChange={(e) => {
          onChange({ text: e.target.value });
          // Auto-expand: reset height then set to scrollHeight
          const el = e.target;
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
        }}
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
          onChange={(e) => onChange({ fontSize: clampFontSize(e.target.value) })}
          min={8}
          max={200}
          title="Font size"
        />
      </div>

      <div className={styles.row}>
        <button
          className={`${styles.styleButton} ${textData.fontWeight === 'bold' ? styles.active : ''}`}
          onClick={() => onChange({ fontWeight: textData.fontWeight === 'bold' ? 'normal' : 'bold' })}
        >
          B
        </button>
        <button
          className={`${styles.styleButton} ${textData.fontStyle === 'italic' ? styles.active : ''}`}
          onClick={() => onChange({ fontStyle: textData.fontStyle === 'italic' ? 'normal' : 'italic' })}
          style={{ fontStyle: 'italic' }}
        >
          I
        </button>
        <select
          className={styles.select}
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
          <span>Text</span>
          <input
            type="color"
            value={textData.color}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </div>
        <div className={styles.colorInput}>
          <span>BG</span>
          <input
            type="color"
            value={textData.backgroundColor.substring(0, 7)}
            onChange={(e) => onChange({ backgroundColor: withBackgroundAlpha(e.target.value) })}
          />
        </div>
      </div>
    </CollapsibleSection>
  );
}
