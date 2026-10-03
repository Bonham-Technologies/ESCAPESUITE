// ESCSUITE-176 item 2 (probe m4). `uploadToHost` carries a recording's bytes,
// so a `?hostOrigin=` that is present but not a bare origin must not silently
// degrade the post to '*' — broadcasting the take to whatever page happens to
// be framing CRAFT. The companion fix (packages/shared/src/config/index.ts)
// normalises a trailing slash or a path down to the origin; what is left here
// is the case `new URL()` genuinely cannot parse, which must refuse the
// upload rather than fall back to the wildcard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { uploadToHost } from './uploadToHost';
import { getAllVideoMetadata, getVideoBlob } from '../core/storage';

vi.mock('../core/storage', () => ({
  getVideoBlob: vi.fn(),
  getAllVideoMetadata: vi.fn(async () => []),
}));

const getVideoBlobMock = getVideoBlob as Mock<typeof getVideoBlob>;
const getAllVideoMetadataMock = getAllVideoMetadata as Mock<typeof getAllVideoMetadata>;

function withSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  });
}

describe('PROBE: a hostOrigin that cannot be parsed', () => {
  let originalParent: typeof window.parent;
  let originalLocation: Location;
  let postMessage: Mock<Window['postMessage']>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalParent = window.parent;
    originalLocation = window.location;
    postMessage = vi.fn<Window['postMessage']>();
    Object.defineProperty(window, 'parent', {
      value: { postMessage },
      writable: true,
      configurable: true,
    });
    getVideoBlobMock.mockResolvedValue(new Blob(['take bytes'], { type: 'video/webm' }));
    getAllVideoMetadataMock.mockResolvedValue([]);
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', { value: originalParent, writable: true, configurable: true });
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  });

  it('does not broadcast the recording to every framer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withSearch(`?hostOrigin=${encodeURIComponent('garbage, not a url')}`);

    await uploadToHost('r7', 'Take Seven');

    expect(postMessage).not.toHaveBeenCalledWith(expect.anything(), '*');
    expect(postMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
