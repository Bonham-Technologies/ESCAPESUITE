import { useRef, useEffect, useCallback, useState } from 'react';
import styles from './InlineTextEditor.module.css';

export interface InlineTextEditorProps {
  clipId: string;
  text: string;
  x: number;           // CSS pixel position on preview container
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;     // CSS pixel size (scaled from canvas)
  fontWeight: string;
  fontStyle: string;
  color: string;
  textAlign: CanvasTextAlign;
  onCommit: (newText: string) => void;
  onCancel: () => void;
}

export function InlineTextEditor({
  text,
  x,
  y,
  width,
  height,
  fontFamily,
  fontSize,
  fontWeight,
  fontStyle,
  color,
  textAlign,
  onCommit,
  onCancel,
}: InlineTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(text);
  const committedRef = useRef(false);

  // Auto-size the textarea to fit its content
  const autoSize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Reset to auto so scrollWidth/scrollHeight reflect content
    textarea.style.width = 'auto';
    textarea.style.height = 'auto';
    // Set to content size (scrollWidth includes the longest line)
    textarea.style.width = `${Math.max(textarea.scrollWidth + 4, 60)}px`;
    textarea.style.height = `${Math.max(textarea.scrollHeight, fontSize * 1.4)}px`;
  }, [fontSize]);

  // Auto-focus and select all text on mount
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      textarea.select();
      autoSize();
    }
  }, [autoSize]);

  const doCommit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  }, [value, onCommit]);

  const doCancel = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  }, [onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      doCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doCommit();
    }
  }, [doCancel, doCommit]);

  const handleBlur = useCallback(() => {
    doCommit();
  }, [doCommit]);

  // Map textAlign to CSS text-align
  const cssTextAlign = textAlign === 'start' ? 'left' : textAlign === 'end' ? 'right' : textAlign;

  // Add some padding so text isn't right at the edge
  const padding = fontSize * 0.15;

  return (
    <textarea
      ref={textareaRef}
      className={styles.inlineTextEditor}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        // Auto-size after React updates the value
        requestAnimationFrame(autoSize);
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        left: `${x - padding}px`,
        top: `${y - padding}px`,
        fontFamily,
        fontSize: `${fontSize}px`,
        fontWeight,
        fontStyle,
        color,
        textAlign: cssTextAlign as React.CSSProperties['textAlign'],
      }}
    />
  );
}
