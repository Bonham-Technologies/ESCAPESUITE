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
    // No take in storage by default, which is what keeps every test below that
    // passes no `takeId` — or a `takeId` that is not the row's own id —
    // asserting the exact payload it asserts today.
    getAllVideoMetadataMock.mockResolvedValue([]);
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

  it('names the part when the row is half of a take', async () => {
    // Slice 1 keeps UPLOAD_RECORDING per row: each row posts its own bytes, and
    // the two new fields say which half the host is being handed. Slice 4 adds
    // `payload.parts` and the adoption note for hosts that want the whole take.
    await uploadToHost('part-2', 'Standup Demo — webcam', { role: 'webcam', takeId: 'take-1' });

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'UPLOAD_RECORDING',
        payload: {
          id: 'part-2',
          name: 'Standup Demo — webcam',
          blob,
          role: 'webcam',
          takeId: 'take-1',
        },
      },
      '*'
    );
  });

  it('reports the recording as missing, and posts nothing, when storage has no blob', async () => {
    getVideoBlobMock.mockResolvedValue(undefined);

    const result = await uploadToHost('gone', 'Vanished Take');

    expect(result).toBe('missing');
    expect(postMessage).not.toHaveBeenCalled();
  });

  describe('a take recorded as separate tracks', () => {
    /** Every part's bytes, keyed by id, as storage would hand them back. */
    const blobs: Record<string, Blob> = {
      'take-1': new Blob(['screen'], { type: 'video/webm' }),
      'part-webcam': new Blob(['camera'], { type: 'video/webm' }),
      'part-mic': new Blob(['mic'], { type: 'audio/webm' }),
    };

    beforeEach(() => {
      getVideoBlobMock.mockImplementation(async (id: string) => blobs[id]);
      getAllVideoMetadataMock.mockResolvedValue([
        {
          id: 'part-mic',
          name: 'Standup Demo — microphone',
          takeId: 'take-1',
          role: 'mic',
          startOffset: 0,
        },
        {
          id: 'take-1',
          name: 'Standup Demo',
          takeId: 'take-1',
          role: 'screen',
          startOffset: 0,
        },
        {
          id: 'part-webcam',
          name: 'Standup Demo — webcam',
          takeId: 'take-1',
          role: 'webcam',
          startOffset: 0,
        },
      ] as unknown as Awaited<ReturnType<typeof getAllVideoMetadata>>);
    });

    it('carries every part of the take, primary first, in one message', async () => {
      const result = await uploadToHost('take-1', 'Standup Demo', {
        role: 'screen',
        takeId: 'take-1',
      });

      expect(result).toBe('posted');
      const [message] = postMessage.mock.calls[0] as [
        {
          payload: {
            id: string;
            name: string;
            blob: Blob;
            parts: Array<{
              id: string;
              role: string;
              name: string;
              blob: Blob;
              startOffset: number;
            }>;
          };
        },
        string,
      ];
      // The three fields a host that knows nothing of takes reads are exactly
      // what they always were: the primary's id, name and bytes.
      expect(message.payload.id).toBe('take-1');
      expect(message.payload.name).toBe('Standup Demo');
      expect(message.payload.blob).toBe(blobs['take-1']);
      // …and `parts` lists every file, the primary included, in role order —
      // never storage order, which is uuid order because every part of a take
      // shares one `recordedAt`.
      expect(message.payload.parts.map((part) => part.role)).toEqual([
        'screen',
        'webcam',
        'mic',
      ]);
      expect(message.payload.parts.map((part) => part.id)).toEqual([
        'take-1',
        'part-webcam',
        'part-mic',
      ]);
      expect(message.payload.parts[1].name).toBe('Standup Demo — webcam');
      expect(message.payload.parts[1].startOffset).toBe(0);
      // The same Blob, not a copy of it: a structured clone of a Blob is a
      // handle, so listing the primary twice costs a reference and not bytes.
      expect(message.payload.parts[0].blob).toBe(message.payload.blob);
    });

    it('posts a companion row on its own, with no parts list', async () => {
      await uploadToHost('part-webcam', 'Standup Demo — webcam', {
        role: 'webcam',
        takeId: 'take-1',
      });

      // A companion row's `takeId` names a different record, so this row is not
      // the take — it is one part of it, and it posts itself. Unchanged from
      // slice 1, and the only way a host that has not adopted `parts` can be
      // handed one specific part.
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'UPLOAD_RECORDING',
          payload: {
            id: 'part-webcam',
            name: 'Standup Demo — webcam',
            blob: blobs['part-webcam'],
            role: 'webcam',
            takeId: 'take-1',
          },
        },
        '*'
      );
    });

    it('sends no parts list for a take that is one file', async () => {
      getAllVideoMetadataMock.mockResolvedValue([
        { id: 'solo', name: 'Solo', takeId: 'solo', role: 'screen' },
      ] as unknown as Awaited<ReturnType<typeof getAllVideoMetadata>>);
      getVideoBlobMock.mockResolvedValue(blob);

      await uploadToHost('solo', 'Solo', { role: 'screen', takeId: 'solo' });

      // `parts` exists to name files the host would not otherwise know about. A
      // list holding only the blob already on `payload.blob` names none of them
      // — and would give the host a second code path for nothing.
      const [message] = postMessage.mock.calls[0] as [
        { payload: Record<string, unknown> },
        string,
      ];
      expect('parts' in message.payload).toBe(false);
    });

    it('leaves out a part whose bytes are gone rather than listing it empty', async () => {
      getVideoBlobMock.mockImplementation(async (id: string) =>
        id === 'part-mic' ? undefined : blobs[id]
      );

      await uploadToHost('take-1', 'Standup Demo', { role: 'screen', takeId: 'take-1' });

      const [message] = postMessage.mock.calls[0] as [
        { payload: { parts: Array<{ role: string }> } },
        string,
      ];
      expect(message.payload.parts.map((part) => part.role)).toEqual(['screen', 'webcam']);
    });

    it('still posts the primary when reading the take’s parts throws', async () => {
      // A companion never costs the primary. The row's own bytes are already in
      // hand at this point, so a failed metadata read downgrades the message to
      // what slice 1 sent rather than losing the upload the user asked for.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getAllVideoMetadataMock.mockRejectedValue(new Error('storage blocked'));

      const result = await uploadToHost('take-1', 'Standup Demo', {
        role: 'screen',
        takeId: 'take-1',
      });

      expect(result).toBe('posted');
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'UPLOAD_RECORDING',
          payload: {
            id: 'take-1',
            name: 'Standup Demo',
            blob: blobs['take-1'],
            role: 'screen',
            takeId: 'take-1',
          },
        },
        '*'
      );
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
