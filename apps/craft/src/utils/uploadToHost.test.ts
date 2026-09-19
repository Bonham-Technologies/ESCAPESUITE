import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { uploadToHost } from './uploadToHost';
import { getVideoBlob } from '../core/storage';

vi.mock('../core/storage', () => ({
  getVideoBlob: vi.fn(),
}));

const getVideoBlobMock = getVideoBlob as Mock<typeof getVideoBlob>;

/** Point window.location.search at a query string for one test. */
function withSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  });
}

describe('uploadToHost', () => {
  let originalParent: typeof window.parent;
  let originalLocation: Location;
  let postMessage: Mock<Window['postMessage']>;
  let blob: Blob;

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
    blob = new Blob(['take bytes'], { type: 'video/webm' });
    getVideoBlobMock.mockResolvedValue(blob);
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('posts UPLOAD_RECORDING to the parent with the id, the name and the stored blob', async () => {
    const result = await uploadToHost('r7', 'Take Seven');

    expect(getVideoBlobMock).toHaveBeenCalledWith('r7');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPLOAD_RECORDING', payload: { id: 'r7', name: 'Take Seven', blob } },
      '*'
    );
    expect(result).toBe('posted');
  });

  it('hands over the blob itself, not a copy of its bytes', async () => {
    // The host gets a structured clone of the same Blob — no arrayBuffer()
    // round trip, which would double a gigabyte take in memory.
    await uploadToHost('r7', 'Take Seven');

    const [message] = postMessage.mock.calls[0] as [
      { payload: { blob: Blob } },
      string,
    ];
    expect(message.payload.blob).toBe(blob);
  });

  it('addresses the post at a valid hostOrigin', async () => {
    withSearch(`?hostOrigin=${encodeURIComponent('https://host.example')}`);

    await uploadToHost('r7', 'Take Seven');

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPLOAD_RECORDING', payload: { id: 'r7', name: 'Take Seven', blob } },
      'https://host.example'
    );
  });

  it('falls back to the wildcard when hostOrigin is invalid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withSearch(`?hostOrigin=${encodeURIComponent('https://host.example/app')}`);

    await uploadToHost('r7', 'Take Seven');

    expect(postMessage).toHaveBeenCalledWith(expect.anything(), '*');
    warn.mockRestore();
  });

  it('reports the recording as missing, and posts nothing, when storage has no blob', async () => {
    getVideoBlobMock.mockResolvedValue(undefined);

    const result = await uploadToHost('gone', 'Vanished Take');

    expect(result).toBe('missing');
    expect(postMessage).not.toHaveBeenCalled();
  });
});
