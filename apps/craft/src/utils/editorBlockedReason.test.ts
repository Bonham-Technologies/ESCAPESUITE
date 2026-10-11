import { describe, it, expect, vi, beforeEach } from 'vitest';
import { editorBlockedReasonFor, EDITOR_UNREACHABLE_REASON } from './sendToEditor';

const { isFileOrigin, isStandaloneMode, editorUrlIsRelative } = vi.hoisted(() => ({
  isFileOrigin: vi.fn(() => false),
  isStandaloneMode: vi.fn(() => false),
  editorUrlIsRelative: vi.fn(() => false),
}));
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isFileOrigin,
  isStandaloneMode,
  editorUrlIsRelative,
}));
vi.mock('./analytics', () => ({ analytics: { recordingSentToEditor: vi.fn() } }));

describe('editorBlockedReasonFor (ESCSUITE-259)', () => {
  beforeEach(() => {
    isFileOrigin.mockReturnValue(false);
    isStandaloneMode.mockReturnValue(false);
    editorUrlIsRelative.mockReturnValue(false);
  });

  it('is null for a hosted build over http, even with a relative editor URL', () => {
    editorUrlIsRelative.mockReturnValue(true);
    expect(editorBlockedReasonFor({ embedded: false })).toBeNull();
  });

  it('blocks a standalone build over http whose editor URL is relative', () => {
    isStandaloneMode.mockReturnValue(true);
    editorUrlIsRelative.mockReturnValue(true);
    expect(editorBlockedReasonFor({ embedded: false })).toBe(EDITOR_UNREACHABLE_REASON);
  });

  it('leaves a standalone build over http with an absolute editor URL alone', () => {
    isStandaloneMode.mockReturnValue(true);
    expect(editorBlockedReasonFor({ embedded: false })).toBeNull();
  });

  it('blocks a file origin whatever the build and the editor URL', () => {
    isFileOrigin.mockReturnValue(true);
    expect(editorBlockedReasonFor({ embedded: false })).toBe(EDITOR_UNREACHABLE_REASON);
  });

  it('is null when embedded, however the page was opened', () => {
    isFileOrigin.mockReturnValue(true);
    isStandaloneMode.mockReturnValue(true);
    editorUrlIsRelative.mockReturnValue(true);
    expect(editorBlockedReasonFor({ embedded: true })).toBeNull();
  });
});
