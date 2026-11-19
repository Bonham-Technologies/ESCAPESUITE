import { describe, it, expect } from 'vitest';
import type { Marker } from '../store/types';
import { buildYoutubeChapters, formatChapterTime } from './youtubeChapters';

const mk = (time: number, label = ''): Marker => ({ id: `m${time}`, time, label, color: '#ffcc00' });

describe('formatChapterTime', () => {
  it('uses M:SS under an hour and H:MM:SS with hours', () => {
    expect(formatChapterTime(0, false)).toBe('0:00');
    expect(formatChapterTime(75.9, false)).toBe('1:15');
    expect(formatChapterTime(754, false)).toBe('12:34');
    expect(formatChapterTime(0, true)).toBe('0:00:00');
    expect(formatChapterTime(3725, true)).toBe('1:02:05');
  });
});

describe('buildYoutubeChapters', () => {
  it('lists markers ascending with an Intro at 0:00 when the first is later', () => {
    const r = buildYoutubeChapters([mk(60, 'Second'), mk(20, 'First'), mk(120, 'Third')], { start: 0, end: 200 });
    expect(r.text).toBe('0:00 Intro\n0:20 First\n1:00 Second\n2:00 Third');
    expect(r.warnings).toEqual([]);
  });

  it('adds no Intro when a marker sits at the start', () => {
    const r = buildYoutubeChapters([mk(0, 'Start'), mk(30, 'B'), mk(60, 'C')], { start: 0, end: 100 });
    expect(r.text.split('\n')[0]).toBe('0:00 Start');
    expect(r.chapters).toHaveLength(3);
  });

  it('drops markers outside the range and offsets the rest', () => {
    const r = buildYoutubeChapters([mk(5, 'Before'), mk(40, 'In A'), mk(70, 'In B'), mk(100, 'At end'), mk(150, 'After')], {
      start: 30,
      end: 100,
    });
    expect(r.text).toBe('0:00 Intro\n0:10 In A\n0:40 In B');
  });

  it('switches every line to H:MM:SS when the range is an hour or longer', () => {
    const r = buildYoutubeChapters([mk(100, 'A'), mk(3700, 'B')], { start: 0, end: 7300 });
    expect(r.text).toBe('0:00:00 Intro\n0:01:40 A\n1:01:40 B');
  });

  it('stays M:SS just under an hour', () => {
    const r = buildYoutubeChapters([mk(3599, 'A')], { start: 0, end: 3599.5 });
    expect(r.text).toBe('0:00 Intro\n59:59 A');
  });

  it('names unlabelled markers Chapter N and collapses whitespace', () => {
    const r = buildYoutubeChapters([mk(10, '  '), mk(30, 'Two\nlines  here'), mk(50)], { start: 0, end: 100 });
    expect(r.chapters.map((c) => c.title)).toEqual(['Intro', 'Chapter 1', 'Two lines here', 'Chapter 3']);
  });

  it('returns nothing when no marker is in range', () => {
    expect(buildYoutubeChapters([mk(500)], { start: 0, end: 100 })).toEqual({ chapters: [], text: '', warnings: [] });
    expect(buildYoutubeChapters([], { start: 0, end: 100 }).text).toBe('');
  });

  it('warns, naming the rule, with fewer than three chapters', () => {
    const r = buildYoutubeChapters([mk(30, 'A')], { start: 0, end: 100 });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/at least 3 chapters/);
  });

  it('warns when a chapter is shorter than 10 seconds, the last one included', () => {
    const r = buildYoutubeChapters([mk(30, 'A'), mk(35, 'B'), mk(97, 'Tail')], { start: 0, end: 100 });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/at least 10 seconds/);
    expect(r.warnings[0]).toContain('"A" at 0:30');
    expect(r.warnings[0]).toContain('"Tail" at 1:37');
    expect(r.warnings[0]).not.toContain('"B"');
  });

  it('keeps the list when it warns', () => {
    expect(buildYoutubeChapters([mk(1, 'X')], { start: 0, end: 5 }).text).toBe('0:00 Intro\n0:01 X');
  });
});
