// Time formatting and conversion utilities

/**
 * Format seconds to timecode string (HH:MM:SS.mmm or MM:SS.mmm)
 */
export function formatTimecode(seconds: number, showHours = false): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  if (showHours || hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Format seconds to simple time string (MM:SS)
 */
export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format seconds to display string with appropriate precision
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  if (minutes < 60) {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}:${remainingMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse timecode string to seconds
 */
export function parseTimecode(timecode: string): number {
  const parts = timecode.split(':').map(Number);

  if (parts.length === 3) {
    // HH:MM:SS or HH:MM:SS.mmm
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // MM:SS or MM:SS.mmm
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  return parseFloat(timecode) || 0;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Round to specified decimal places
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Convert pixels to time based on zoom level
 */
export function pixelsToTime(pixels: number, pixelsPerSecond: number): number {
  return pixels / pixelsPerSecond;
}

/**
 * Convert time to pixels based on zoom level
 */
export function timeToPixels(time: number, pixelsPerSecond: number): number {
  return time * pixelsPerSecond;
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
