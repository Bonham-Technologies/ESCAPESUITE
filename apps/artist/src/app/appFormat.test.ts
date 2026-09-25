// appFormat on its own: no App, no notification state — just the strings.
import { describe, it, expect } from 'vitest';
import { clipCountMessage, formatTimeForNotification, takeLoadedMessage } from './appFormat';

describe('clipCountMessage', () => {
  it('pluralises "clips" for zero', () => {
    expect(clipCountMessage(0, 'deleted')).toBe('0 clips deleted');
  });

  it('keeps "clip" singular for one', () => {
    expect(clipCountMessage(1, 'deleted')).toBe('1 clip deleted');
  });

  it('pluralises "clips" for two', () => {
    expect(clipCountMessage(2, 'deleted')).toBe('2 clips deleted');
  });

  it('renders the copied message', () => {
    expect(clipCountMessage(0, 'copied')).toBe('0 clips copied');
    expect(clipCountMessage(1, 'copied')).toBe('1 clip copied');
    expect(clipCountMessage(2, 'copied')).toBe('2 clips copied');
  });

  it('renders the pasted message', () => {
    expect(clipCountMessage(0, 'pasted')).toBe('0 clips pasted');
    expect(clipCountMessage(1, 'pasted')).toBe('1 clip pasted');
    expect(clipCountMessage(2, 'pasted')).toBe('2 clips pasted');
  });
});

describe('formatTimeForNotification', () => {
  it('formats a sub-minute time as m:ss', () => {
    expect(formatTimeForNotification(4)).toBe('0:04');
  });

  it('formats a time past a minute as m:ss', () => {
    expect(formatTimeForNotification(65)).toBe('1:05');
  });
});

describe('takeLoadedMessage', () => {
  it('names a single-file recording exactly as it always has', () => {
    // Unchanged copy, deliberately: a plain take is the overwhelming majority
    // of handoffs and this is the sentence its tests already pin.
    expect(takeLoadedMessage('Screen recording', 1, 0)).toBe('Loaded recording: Screen recording');
  });

  it('says how many tracks a multi-part take came in on', () => {
    expect(takeLoadedMessage('Screen recording', 2, 0)).toBe(
      'Loaded recording: Screen recording (2 tracks)'
    );
  });

  it('says what was missing, and says it instead of the happy sentence', () => {
    // One toast slot on a three-second timer: two messages would mean the first
    // is never read, so the problem takes the slot.
    expect(takeLoadedMessage('Screen recording', 1, 1)).toBe(
      'Loaded recording: Screen recording — 1 missing part skipped'
    );
    expect(takeLoadedMessage('Screen recording', 1, 2)).toBe(
      'Loaded recording: Screen recording — 2 missing parts skipped'
    );
  });
});
