import type { Marker } from '../store/types';

/** YouTube's rules for automatic chapters (ESCSUITE-472). */
export const MIN_CHAPTERS = 3;
export const MIN_CHAPTER_SECONDS = 10;

export interface YoutubeChapter {
  /** Whole seconds from the start of the exported range. */
  time: number;
  title: string;
}

export interface YoutubeChapters {
  chapters: YoutubeChapter[];
  /** One `M:SS Title` (or `H:MM:SS Title`) line per chapter. Empty when no marker is in range. */
  text: string;
  /** Each YouTube rule the list does not meet, named. Never blocks. */
  warnings: string[];
}

/** `M:SS` under an hour, `H:MM:SS` from an hour on. */
export function formatChapterTime(seconds: number, withHours: boolean): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = s.toString().padStart(2, '0');
  return withHours ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${Math.floor(whole / 60)}:${ss}`;
}

/**
 * The timeline markers as a YouTube chapter list for the exported `range`.
 * Markers outside `[start, end)` are dropped and the rest are offset to the
 * range's start; an "Intro" at 0:00 is added when the first one is later.
 * Every line uses `H:MM:SS` when the range is an hour or longer, else `M:SS`.
 */
export function buildYoutubeChapters(markers: readonly Marker[], range: { start: number; end: number }): YoutubeChapters {
  const length = Math.max(0, range.end - range.start);
  const withHours = length >= 3600;
  const kept = markers
    .filter((m) => m.time >= range.start && m.time < range.end)
    .sort((a, b) => a.time - b.time)
    .map((m, i) => ({
      time: Math.floor(m.time - range.start),
      title: m.label.replace(/\s+/g, ' ').trim() || `Chapter ${i + 1}`,
    }));
  if (kept.length === 0) return { chapters: [], text: '', warnings: [] };

  const chapters: YoutubeChapter[] = kept[0].time > 0 ? [{ time: 0, title: 'Intro' }, ...kept] : kept;
  const text = chapters.map((c) => `${formatChapterTime(c.time, withHours)} ${c.title}`).join('\n');

  const warnings: string[] = [];
  if (chapters.length < MIN_CHAPTERS) {
    warnings.push(`YouTube needs at least ${MIN_CHAPTERS} chapters (timestamps) in a list; this one has ${chapters.length}.`);
  }
  const short = chapters.filter((c, i) => (i + 1 < chapters.length ? chapters[i + 1].time : length) - c.time < MIN_CHAPTER_SECONDS);
  if (short.length > 0) {
    const names = short.map((c) => `"${c.title}" at ${formatChapterTime(c.time, withHours)}`).join(', ');
    warnings.push(`YouTube chapters must be at least ${MIN_CHAPTER_SECONDS} seconds long; too short: ${names}.`);
  }
  return { chapters, text, warnings };
}
