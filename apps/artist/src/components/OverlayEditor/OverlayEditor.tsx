import { useCallback, useMemo } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { formatDuration } from '../../utils/timeUtils';
import type { TextOverlay, ShapeOverlay, TextAlign, ShapeType, Clip, TextOverlayData, ShapeOverlayData } from '../../store/types';
import styles from './OverlayEditor.module.css';

export function OverlayEditor() {
  // Legacy overlays (for backwards compatibility)
  const textOverlays = useEditorStore((state) => state.project.timeline.textOverlays || []);
  const shapeOverlays = useEditorStore((state) => state.project.timeline.shapeOverlays || []);

  // Clip-based overlays
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);

  // Legacy selection state (kept for backwards compatibility)
  const selectedOverlayId = useEditorStore((state) => state.selectedOverlayId);
  const selectedOverlayType = useEditorStore((state) => state.selectedOverlayType);

  // New clip-based overlay actions
  const addTextOverlayClip = useEditorStore((state) => state.addTextOverlayClip);
  const addShapeOverlayClip = useEditorStore((state) => state.addShapeOverlayClip);
  const updateTextOverlayData = useEditorStore((state) => state.updateTextOverlayData);
  const updateShapeOverlayData = useEditorStore((state) => state.updateShapeOverlayData);
  const removeClipFromTimeline = useEditorStore((state) => state.removeClipFromTimeline);
  const updateClip = useEditorStore((state) => state.updateClip);
  const setSelectedClipId = useEditorStore((state) => state.setSelectedClipId);

  // Legacy overlay actions (for backwards compatibility)
  const updateTextOverlay = useEditorStore((state) => state.updateTextOverlay);
  const removeTextOverlay = useEditorStore((state) => state.removeTextOverlay);
  const updateShapeOverlay = useEditorStore((state) => state.updateShapeOverlay);
  const removeShapeOverlay = useEditorStore((state) => state.removeShapeOverlay);
  const setSelectedOverlay = useEditorStore((state) => state.setSelectedOverlay);

  // Get overlay clips from the clips array
  const overlayClips = useMemo(() =>
    clips.filter(clip => clip.overlayType === 'text' || clip.overlayType === 'shape'),
    [clips]
  );

  const textOverlayClips = useMemo(() =>
    overlayClips.filter(clip => clip.overlayType === 'text'),
    [overlayClips]
  );

  const shapeOverlayClips = useMemo(() =>
    overlayClips.filter(clip => clip.overlayType === 'shape'),
    [overlayClips]
  );

  // Find selected clip if it's an overlay clip
  const selectedOverlayClip = useMemo(() => {
    if (!selectedClipId) return null;
    return overlayClips.find(c => c.id === selectedClipId) || null;
  }, [overlayClips, selectedClipId]);

  // Legacy selected overlays
  const selectedTextOverlay = useMemo(() => {
    if (selectedOverlayType !== 'text' || !selectedOverlayId) return null;
    return textOverlays.find(o => o.id === selectedOverlayId) || null;
  }, [textOverlays, selectedOverlayId, selectedOverlayType]);

  const selectedShapeOverlay = useMemo(() => {
    if (selectedOverlayType !== 'shape' || !selectedOverlayId) return null;
    return shapeOverlays.find(o => o.id === selectedOverlayId) || null;
  }, [shapeOverlays, selectedOverlayId, selectedOverlayType]);

  // Add overlay as a clip (new behavior)
  const handleAddTextClip = useCallback(() => {
    addTextOverlayClip();
  }, [addTextOverlayClip]);

  const handleAddShapeClip = useCallback((type: ShapeType) => {
    addShapeOverlayClip({ type });
  }, [addShapeOverlayClip]);

  // Delete overlay clip
  const handleDeleteOverlayClip = useCallback(() => {
    if (!selectedClipId) return;
    removeClipFromTimeline(selectedClipId);
    setSelectedClipId(null);
  }, [selectedClipId, removeClipFromTimeline, setSelectedClipId]);

  // Legacy delete
  const handleDeleteOverlay = useCallback(() => {
    if (!selectedOverlayId) return;
    if (selectedOverlayType === 'text') {
      removeTextOverlay(selectedOverlayId);
    } else if (selectedOverlayType === 'shape') {
      removeShapeOverlay(selectedOverlayId);
    }
  }, [selectedOverlayId, selectedOverlayType, removeTextOverlay, removeShapeOverlay]);

  // Check if we have a selected overlay clip to edit
  if (selectedOverlayClip) {
    if (selectedOverlayClip.overlayType === 'text' && selectedOverlayClip.textData) {
      return (
        <TextOverlayClipEditor
          clip={selectedOverlayClip}
          onUpdateTextData={(updates) => updateTextOverlayData(selectedOverlayClip.id, updates)}
          onUpdateClip={(updates) => updateClip(selectedOverlayClip.id, updates)}
          onDelete={handleDeleteOverlayClip}
          onBack={() => setSelectedClipId(null)}
        />
      );
    }

    if (selectedOverlayClip.overlayType === 'shape' && selectedOverlayClip.shapeData) {
      return (
        <ShapeOverlayClipEditor
          clip={selectedOverlayClip}
          onUpdateShapeData={(updates) => updateShapeOverlayData(selectedOverlayClip.id, updates)}
          onUpdateClip={(updates) => updateClip(selectedOverlayClip.id, updates)}
          onDelete={handleDeleteOverlayClip}
          onBack={() => setSelectedClipId(null)}
        />
      );
    }
  }

  // Legacy text overlay editor
  if (selectedTextOverlay) {
    return (
      <TextOverlayEditor
        overlay={selectedTextOverlay}
        onUpdate={(updates) => updateTextOverlay(selectedTextOverlay.id, updates)}
        onDelete={handleDeleteOverlay}
        onBack={() => setSelectedOverlay(null, null)}
      />
    );
  }

  // Legacy shape overlay editor
  if (selectedShapeOverlay) {
    return (
      <ShapeOverlayEditor
        overlay={selectedShapeOverlay}
        onUpdate={(updates) => updateShapeOverlay(selectedShapeOverlay.id, updates)}
        onDelete={handleDeleteOverlay}
        onBack={() => setSelectedOverlay(null, null)}
      />
    );
  }

  // Default view: show overlay list and add buttons
  const hasOverlayClips = overlayClips.length > 0;
  const hasLegacyOverlays = textOverlays.length > 0 || shapeOverlays.length > 0;
  const hasAnyOverlays = hasOverlayClips || hasLegacyOverlays;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Overlays</h3>
      </div>

      <div className={styles.addButtons}>
        <button className={styles.addButton} onClick={handleAddTextClip}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3" />
            <path d="M12 4v16" />
            <path d="M8 20h8" />
          </svg>
          Add Text
        </button>
        <button className={styles.addButton} onClick={() => handleAddShapeClip('rectangle')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          Rectangle
        </button>
        <button className={styles.addButton} onClick={() => handleAddShapeClip('ellipse')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="12" rx="9" ry="7" />
          </svg>
          Ellipse
        </button>
        <button className={styles.addButton} onClick={() => handleAddShapeClip('arrow')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          Arrow
        </button>
        <button className={styles.addButton} onClick={() => handleAddShapeClip('blur')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
            <circle cx="12" cy="12" r="4" />
          </svg>
          Blur
        </button>
      </div>

      {hasAnyOverlays && (
        <div className={styles.overlayList}>
          {/* Clip-based text overlays */}
          <h4 className={styles.sectionTitle}>Text Overlays</h4>
          {textOverlayClips.map(clip => (
            <div
              key={clip.id}
              className={`${styles.overlayItem} ${selectedClipId === clip.id ? styles.overlayItemSelected : ''}`}
              onClick={() => setSelectedClipId(clip.id)}
            >
              <span className={styles.overlayIcon}>T</span>
              <span className={styles.overlayName}>
                {clip.textData?.text.substring(0, 20)}{(clip.textData?.text.length || 0) > 20 ? '...' : ''}
              </span>
              <span className={styles.overlayTime}>
                {formatDuration(clip.timelinePosition)} - {formatDuration(clip.timelinePosition + clip.duration)}
              </span>
            </div>
          ))}
          {/* Legacy text overlays */}
          {textOverlays.map(overlay => (
            <div
              key={overlay.id}
              className={`${styles.overlayItem} ${styles.overlayItemLegacy}`}
              onClick={() => setSelectedOverlay(overlay.id, 'text')}
            >
              <span className={styles.overlayIcon}>T</span>
              <span className={styles.overlayName}>{overlay.text.substring(0, 20)}{overlay.text.length > 20 ? '...' : ''}</span>
              <span className={styles.overlayTime}>
                {formatDuration(overlay.startTime)} - {formatDuration(overlay.endTime)}
              </span>
            </div>
          ))}
          {textOverlayClips.length === 0 && textOverlays.length === 0 && (
            <div className={styles.emptyText}>No text overlays</div>
          )}

          {/* Clip-based shape overlays */}
          <h4 className={styles.sectionTitle}>Shape Overlays</h4>
          {shapeOverlayClips.map(clip => (
            <div
              key={clip.id}
              className={`${styles.overlayItem} ${selectedClipId === clip.id ? styles.overlayItemSelected : ''}`}
              onClick={() => setSelectedClipId(clip.id)}
            >
              <span className={styles.overlayIcon}>
                {clip.shapeData?.type === 'rectangle' && '▢'}
                {clip.shapeData?.type === 'ellipse' && '○'}
                {clip.shapeData?.type === 'line' && '—'}
                {clip.shapeData?.type === 'arrow' && '→'}
              </span>
              <span className={styles.overlayName}>{clip.shapeData?.type}</span>
              <span className={styles.overlayTime}>
                {formatDuration(clip.timelinePosition)} - {formatDuration(clip.timelinePosition + clip.duration)}
              </span>
            </div>
          ))}
          {/* Legacy shape overlays */}
          {shapeOverlays.map(overlay => (
            <div
              key={overlay.id}
              className={`${styles.overlayItem} ${styles.overlayItemLegacy}`}
              onClick={() => setSelectedOverlay(overlay.id, 'shape')}
            >
              <span className={styles.overlayIcon}>
                {overlay.type === 'rectangle' && '▢'}
                {overlay.type === 'ellipse' && '○'}
                {overlay.type === 'line' && '—'}
                {overlay.type === 'arrow' && '→'}
              </span>
              <span className={styles.overlayName}>{overlay.type}</span>
              <span className={styles.overlayTime}>
                {formatDuration(overlay.startTime)} - {formatDuration(overlay.endTime)}
              </span>
            </div>
          ))}
          {shapeOverlayClips.length === 0 && shapeOverlays.length === 0 && (
            <div className={styles.emptyText}>No shape overlays</div>
          )}
        </div>
      )}

      {!hasAnyOverlays && (
        <div className={styles.empty}>
          <p>No overlays yet</p>
          <p className={styles.hint}>Add text or shapes to overlay on your video</p>
        </div>
      )}
    </div>
  );
}

// New clip-based text overlay editor
interface TextOverlayClipEditorProps {
  clip: Clip;
  onUpdateTextData: (updates: Partial<TextOverlayData>) => void;
  onUpdateClip: (updates: Partial<Clip>) => void;
  onDelete: () => void;
  onBack: () => void;
}

function TextOverlayClipEditor({ clip, onUpdateTextData, onUpdateClip, onDelete, onBack }: TextOverlayClipEditorProps) {
  const textData = clip.textData!;
  const opacity = clip.transform?.opacity ?? 1;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className={styles.title}>Text Overlay</h3>
        <button className={styles.deleteButton} onClick={onDelete} title="Delete overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Text</label>
        <textarea
          className={styles.textarea}
          value={textData.text}
          onChange={(e) => onUpdateTextData({ text: e.target.value })}
          rows={3}
        />
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Font</label>
        <div className={styles.row}>
          <select
            className={styles.select}
            value={textData.fontFamily}
            onChange={(e) => onUpdateTextData({ fontFamily: e.target.value })}
          >
            <option value="Arial">Arial</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Georgia">Georgia</option>
            <option value="Verdana">Verdana</option>
            <option value="Courier New">Courier New</option>
            <option value="Impact">Impact</option>
          </select>
          <input
            type="number"
            className={styles.numberInput}
            value={textData.fontSize}
            onChange={(e) => onUpdateTextData({ fontSize: Math.max(8, parseInt(e.target.value) || 48) })}
            min={8}
            max={200}
          />
        </div>
        <div className={styles.row}>
          <button
            className={`${styles.styleButton} ${textData.fontWeight === 'bold' ? styles.active : ''}`}
            onClick={() => onUpdateTextData({ fontWeight: textData.fontWeight === 'bold' ? 'normal' : 'bold' })}
          >
            B
          </button>
          <button
            className={`${styles.styleButton} ${textData.fontStyle === 'italic' ? styles.active : ''}`}
            onClick={() => onUpdateTextData({ fontStyle: textData.fontStyle === 'italic' ? 'normal' : 'italic' })}
            style={{ fontStyle: 'italic' }}
          >
            I
          </button>
          <select
            className={styles.select}
            value={textData.textAlign}
            onChange={(e) => onUpdateTextData({ textAlign: e.target.value as TextAlign })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Colors</label>
        <div className={styles.row}>
          <div className={styles.colorInput}>
            <span>Text</span>
            <input
              type="color"
              value={textData.color}
              onChange={(e) => onUpdateTextData({ color: e.target.value })}
            />
          </div>
          <div className={styles.colorInput}>
            <span>Background</span>
            <input
              type="color"
              value={textData.backgroundColor.substring(0, 7)}
              onChange={(e) => onUpdateTextData({ backgroundColor: e.target.value + 'cc' })}
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Position</label>
        <div className={styles.sliderRow}>
          <span>X</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={textData.x}
            onChange={(e) => onUpdateTextData({ x: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(textData.x * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span>Y</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={textData.y}
            onChange={(e) => onUpdateTextData({ y: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(textData.y * 100)}%</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Transform</label>
        <div className={styles.sliderRow}>
          <span>Scale</span>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.05"
            value={textData.scale ?? 1}
            onChange={(e) => onUpdateTextData({ scale: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round((textData.scale ?? 1) * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span>Rotate</span>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={textData.rotation ?? 0}
            onChange={(e) => onUpdateTextData({ rotation: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(textData.rotation ?? 0)}°</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Duration</label>
        <div className={styles.row}>
          <div className={styles.timeInput}>
            <span>Length</span>
            <input
              type="number"
              value={clip.duration.toFixed(2)}
              onChange={(e) => {
                const newDuration = Math.max(0.1, parseFloat(e.target.value) || 0);
                onUpdateClip({
                  duration: newDuration,
                  endTime: newDuration
                });
              }}
              step="0.1"
              min="0.1"
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Opacity</label>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacity}
            onChange={(e) => onUpdateClip({
              transform: { ...clip.transform, opacity: parseFloat(e.target.value) }
            })}
          />
          <span className={styles.value}>{Math.round(opacity * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

// New clip-based shape overlay editor
interface ShapeOverlayClipEditorProps {
  clip: Clip;
  onUpdateShapeData: (updates: Partial<ShapeOverlayData>) => void;
  onUpdateClip: (updates: Partial<Clip>) => void;
  onDelete: () => void;
  onBack: () => void;
}

function ShapeOverlayClipEditor({ clip, onUpdateShapeData, onUpdateClip, onDelete, onBack }: ShapeOverlayClipEditorProps) {
  const shapeData = clip.shapeData!;
  const opacity = clip.transform?.opacity ?? 1;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className={styles.title}>Shape Overlay</h3>
        <button className={styles.deleteButton} onClick={onDelete} title="Delete overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Shape Type</label>
        <select
          className={styles.select}
          value={shapeData.type}
          onChange={(e) => onUpdateShapeData({ type: e.target.value as ShapeType })}
        >
          <option value="rectangle">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="line">Line</option>
          <option value="arrow">Arrow</option>
          <option value="blur">Blur Region</option>
        </select>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Colors</label>
        <div className={styles.row}>
          <div className={styles.colorInput}>
            <span>Fill</span>
            <input
              type="color"
              value={shapeData.fillColor.substring(0, 7)}
              onChange={(e) => onUpdateShapeData({ fillColor: e.target.value + '80' })}
            />
          </div>
          <div className={styles.colorInput}>
            <span>Stroke</span>
            <input
              type="color"
              value={shapeData.strokeColor}
              onChange={(e) => onUpdateShapeData({ strokeColor: e.target.value })}
            />
          </div>
        </div>
        <div className={styles.sliderRow}>
          <span>Stroke Width</span>
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={shapeData.strokeWidth}
            onChange={(e) => onUpdateShapeData({ strokeWidth: parseInt(e.target.value) })}
          />
          <span className={styles.value}>{shapeData.strokeWidth}px</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Position</label>
        <div className={styles.sliderRow}>
          <span>X</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={shapeData.x}
            onChange={(e) => onUpdateShapeData({ x: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(shapeData.x * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span>Y</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={shapeData.y}
            onChange={(e) => onUpdateShapeData({ y: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(shapeData.y * 100)}%</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Size</label>
        <div className={styles.sliderRow}>
          <span>Width</span>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={shapeData.width}
            onChange={(e) => onUpdateShapeData({ width: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(shapeData.width * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span>Height</span>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={shapeData.height}
            onChange={(e) => onUpdateShapeData({ height: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(shapeData.height * 100)}%</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Rotation</label>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={shapeData.rotation}
            onChange={(e) => onUpdateShapeData({ rotation: parseInt(e.target.value) })}
          />
          <span className={styles.value}>{shapeData.rotation}°</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Duration</label>
        <div className={styles.row}>
          <div className={styles.timeInput}>
            <span>Length</span>
            <input
              type="number"
              value={clip.duration.toFixed(2)}
              onChange={(e) => {
                const newDuration = Math.max(0.1, parseFloat(e.target.value) || 0);
                onUpdateClip({
                  duration: newDuration,
                  endTime: newDuration
                });
              }}
              step="0.1"
              min="0.1"
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Opacity</label>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacity}
            onChange={(e) => onUpdateClip({
              transform: { ...clip.transform, opacity: parseFloat(e.target.value) }
            })}
          />
          <span className={styles.value}>{Math.round(opacity * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

// Legacy text overlay editor (for backwards compatibility)
interface TextOverlayEditorProps {
  overlay: TextOverlay;
  onUpdate: (updates: Partial<TextOverlay>) => void;
  onDelete: () => void;
  onBack: () => void;
}

function TextOverlayEditor({ overlay, onUpdate, onDelete, onBack }: TextOverlayEditorProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className={styles.title}>Text Overlay (Legacy)</h3>
        <button className={styles.deleteButton} onClick={onDelete} title="Delete overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Text</label>
        <textarea
          className={styles.textarea}
          value={overlay.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          rows={3}
        />
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Font</label>
        <div className={styles.row}>
          <select
            className={styles.select}
            value={overlay.fontFamily}
            onChange={(e) => onUpdate({ fontFamily: e.target.value })}
          >
            <option value="Arial">Arial</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Georgia">Georgia</option>
            <option value="Verdana">Verdana</option>
            <option value="Courier New">Courier New</option>
            <option value="Impact">Impact</option>
          </select>
          <input
            type="number"
            className={styles.numberInput}
            value={overlay.fontSize}
            onChange={(e) => onUpdate({ fontSize: Math.max(8, parseInt(e.target.value) || 48) })}
            min={8}
            max={200}
          />
        </div>
        <div className={styles.row}>
          <button
            className={`${styles.styleButton} ${overlay.fontWeight === 'bold' ? styles.active : ''}`}
            onClick={() => onUpdate({ fontWeight: overlay.fontWeight === 'bold' ? 'normal' : 'bold' })}
          >
            B
          </button>
          <button
            className={`${styles.styleButton} ${overlay.fontStyle === 'italic' ? styles.active : ''}`}
            onClick={() => onUpdate({ fontStyle: overlay.fontStyle === 'italic' ? 'normal' : 'italic' })}
            style={{ fontStyle: 'italic' }}
          >
            I
          </button>
          <select
            className={styles.select}
            value={overlay.textAlign}
            onChange={(e) => onUpdate({ textAlign: e.target.value as TextAlign })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Colors</label>
        <div className={styles.row}>
          <div className={styles.colorInput}>
            <span>Text</span>
            <input
              type="color"
              value={overlay.color}
              onChange={(e) => onUpdate({ color: e.target.value })}
            />
          </div>
          <div className={styles.colorInput}>
            <span>Background</span>
            <input
              type="color"
              value={overlay.backgroundColor.substring(0, 7)}
              onChange={(e) => onUpdate({ backgroundColor: e.target.value + 'cc' })}
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Position</label>
        <div className={styles.sliderRow}>
          <span>X</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.x}
            onChange={(e) => onUpdate({ x: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.x * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span>Y</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.y}
            onChange={(e) => onUpdate({ y: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.y * 100)}%</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Timing</label>
        <div className={styles.row}>
          <div className={styles.timeInput}>
            <span>Start</span>
            <input
              type="number"
              value={overlay.startTime.toFixed(2)}
              onChange={(e) => onUpdate({ startTime: Math.max(0, parseFloat(e.target.value) || 0) })}
              step="0.1"
              min="0"
            />
          </div>
          <div className={styles.timeInput}>
            <span>End</span>
            <input
              type="number"
              value={overlay.endTime.toFixed(2)}
              onChange={(e) => onUpdate({ endTime: Math.max(overlay.startTime + 0.1, parseFloat(e.target.value) || 0) })}
              step="0.1"
              min="0"
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Opacity</label>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.opacity}
            onChange={(e) => onUpdate({ opacity: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.opacity * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

// Legacy shape overlay editor (for backwards compatibility)
interface ShapeOverlayEditorProps {
  overlay: ShapeOverlay;
  onUpdate: (updates: Partial<ShapeOverlay>) => void;
  onDelete: () => void;
  onBack: () => void;
}

function ShapeOverlayEditor({ overlay, onUpdate, onDelete, onBack }: ShapeOverlayEditorProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className={styles.title}>Shape Overlay (Legacy)</h3>
        <button className={styles.deleteButton} onClick={onDelete} title="Delete overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Shape Type</label>
        <select
          className={styles.select}
          value={overlay.type}
          onChange={(e) => onUpdate({ type: e.target.value as ShapeType })}
        >
          <option value="rectangle">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="line">Line</option>
          <option value="arrow">Arrow</option>
          <option value="blur">Blur Region</option>
        </select>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Colors</label>
        <div className={styles.row}>
          <div className={styles.colorInput}>
            <span>Fill</span>
            <input
              type="color"
              value={overlay.fillColor.substring(0, 7)}
              onChange={(e) => onUpdate({ fillColor: e.target.value + '80' })}
            />
          </div>
          <div className={styles.colorInput}>
            <span>Stroke</span>
            <input
              type="color"
              value={overlay.strokeColor}
              onChange={(e) => onUpdate({ strokeColor: e.target.value })}
            />
          </div>
        </div>
        <div className={styles.sliderRow}>
          <span>Stroke Width</span>
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={overlay.strokeWidth}
            onChange={(e) => onUpdate({ strokeWidth: parseInt(e.target.value) })}
          />
          <span className={styles.value}>{overlay.strokeWidth}px</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Position</label>
        <div className={styles.sliderRow}>
          <span>X</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.x}
            onChange={(e) => onUpdate({ x: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.x * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span>Y</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.y}
            onChange={(e) => onUpdate({ y: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.y * 100)}%</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Size</label>
        <div className={styles.sliderRow}>
          <span>Width</span>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={overlay.width}
            onChange={(e) => onUpdate({ width: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.width * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span>Height</span>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={overlay.height}
            onChange={(e) => onUpdate({ height: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.height * 100)}%</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Rotation</label>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={overlay.rotation}
            onChange={(e) => onUpdate({ rotation: parseInt(e.target.value) })}
          />
          <span className={styles.value}>{overlay.rotation}°</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Timing</label>
        <div className={styles.row}>
          <div className={styles.timeInput}>
            <span>Start</span>
            <input
              type="number"
              value={overlay.startTime.toFixed(2)}
              onChange={(e) => onUpdate({ startTime: Math.max(0, parseFloat(e.target.value) || 0) })}
              step="0.1"
              min="0"
            />
          </div>
          <div className={styles.timeInput}>
            <span>End</span>
            <input
              type="number"
              value={overlay.endTime.toFixed(2)}
              onChange={(e) => onUpdate({ endTime: Math.max(overlay.startTime + 0.1, parseFloat(e.target.value) || 0) })}
              step="0.1"
              min="0"
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Opacity</label>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.opacity}
            onChange={(e) => onUpdate({ opacity: parseFloat(e.target.value) })}
          />
          <span className={styles.value}>{Math.round(overlay.opacity * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
