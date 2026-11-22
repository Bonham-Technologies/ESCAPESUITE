// Writing straight to a file the user picks (ESCSUITE-470).
//
// Where the browser has the File System Access API's save picker (Chromium),
// an export asks where to go before it starts and the muxer writes into that
// file as it goes, so a long export never sits whole in the page's blob store,
// and project Save writes over the file it last opened or saved. Every other
// browser keeps the download it always had.
import type { StreamTargetChunk } from 'mediabunny';

/** What a muxer writes into, and what hands back the finished file. */
export interface ExportSink {
  writable: WritableStream<StreamTargetChunk>;
  /** Called once the muxer has finalized: the finished file. */
  finish: (type: string) => Promise<Blob>;
}

/** One entry of the picker's "Save as type" list. */
export interface SaveFileType {
  description: string;
  accept: Record<string, string[]>;
}

/** The save picker, which the DOM lib does not declare (Chromium only). */
interface WindowWithSaveFilePicker {
  showSaveFilePicker(options: { suggestedName?: string; types?: SaveFileType[] }): Promise<FileSystemFileHandle>;
}

/** The parts of a handle the DOM lib leaves out: Chromium's permission calls and `remove()`. */
interface HandleExtras {
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  remove?: () => Promise<void>;
}

/** Whether this browser can ask where to save. */
export function canPickSaveFile(): boolean {
  return typeof (window as unknown as Partial<WindowWithSaveFilePicker>).showSaveFilePicker === 'function';
}

/**
 * Whether a save picker this page opens would show (ESCSUITE-498): the browser
 * has one, and the page is the top-level page or from the same origin as it.
 * Chromium refuses the picker in a frame from another origin (`SecurityError`),
 * and the save then downloads. The export buttons say Export or Download by it.
 */
export function mayPickSaveFile(): boolean {
  if (!canPickSaveFile()) return false;
  try {
    return window.top === window || window.top?.location.origin === window.location.origin;
  } catch {
    // Reading another origin's location throws: a cross-origin frame.
    return false;
  }
}

/** Where a save goes: a picked file, the download it always was, or nowhere (the user cancelled). */
export type SaveDestination =
  | { kind: 'file'; handle: FileSystemFileHandle }
  | { kind: 'download' }
  | { kind: 'cancelled' };

/**
 * Ask where to save. Call it from the click itself, before anything is
 * awaited: the picker needs the gesture's activation, and an `await` before it
 * can spend it.
 *
 * A picker the page is not allowed to open (no activation left, or a
 * cross-origin frame: `SecurityError`) leaves the download, as in a browser
 * without one. Anything else but a cancel is thrown.
 */
export async function chooseSaveDestination(suggestedName: string, type: SaveFileType): Promise<SaveDestination> {
  if (!canPickSaveFile()) return { kind: 'download' };
  try {
    const handle = await (window as unknown as WindowWithSaveFilePicker).showSaveFilePicker({
      suggestedName,
      types: [type],
    });
    return { kind: 'file', handle };
  } catch (error) {
    const name = errorName(error);
    if (name === 'AbortError') return { kind: 'cancelled' };
    if (name === 'SecurityError') return { kind: 'download' };
    throw error;
  }
}

/**
 * Ask for write access to a handle the open picker gave (read access only).
 * Like the picker, it needs the gesture, so call it before any `await`. A
 * handle with no permission calls (one the save picker made) is writable.
 */
export async function mayWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const { requestPermission } = handle as FileSystemFileHandle & HandleExtras;
  if (typeof requestPermission !== 'function') return true;
  return (await requestPermission.call(handle, { mode: 'readwrite' })) === 'granted';
}

/** A write to the chosen file that failed, in words a user can act on. */
export class FileWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileWriteError';
  }
}

function errorName(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
}

/** An error's own message (a `DOMException`'s included), else the value as text. */
export function errorMessage(error: unknown): string {
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message ? message : String(error);
}

/** Word a failed write for the user, naming the file. */
export function fileWriteError(error: unknown, fileName: string): FileWriteError {
  if (error instanceof FileWriteError) return error;
  const cannot = `Could not write "${fileName}"`;
  switch (errorName(error)) {
    case 'QuotaExceededError':
      return new FileWriteError(`${cannot}: the disk is full. Free some space or choose another drive, then try again.`);
    case 'NotAllowedError':
    case 'SecurityError':
      return new FileWriteError(`${cannot}: permission to write to it was taken away. Choose the file again to give it back.`);
    case 'NotFoundError':
      return new FileWriteError(`${cannot}: it was moved or deleted while it was being written.`);
    case 'NoModificationAllowedError':
    case 'InvalidStateError':
      return new FileWriteError(`${cannot}: another program is using it.`);
    default:
      return new FileWriteError(`${cannot}: ${errorMessage(error)}`);
  }
}

/** Write a finished file over `handle` in one go: all of it, or (on a failure) none of it. */
export async function writeBlobToFile(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  let stream: FileSystemWritableFileStream;
  try {
    stream = await handle.createWritable();
  } catch (error) {
    throw fileWriteError(error, handle.name);
  }
  try {
    await stream.write(blob);
    await stream.close();
  } catch (error) {
    // Writes land in a copy the browser swaps in on close, so an abort leaves
    // the file as it was.
    await stream.abort().catch(() => {});
    throw fileWriteError(error, handle.name);
  }
}

/** An export sink that writes into a file the user picked. */
export interface FileSink extends ExportSink {
  /** The file's name, as the user chose it. */
  readonly name: string;
  /** The write that failed, worded for the user; null while every write has landed. */
  readonly failure: FileWriteError | null;
  /** Write a finished file (a GIF, which cannot stream) in one go and commit it. */
  writeAll: (blob: Blob) => Promise<Blob>;
  /**
   * Throw the export's bytes away. The file keeps what it held before; a file
   * the picker made for this export (still empty) is removed where the browser
   * can.
   */
  discard: () => Promise<void>;
}

/**
 * Open `handle` for an export. The muxer's positioned writes go straight to
 * the file (`FileSystemWritableFileStream.write({ type: 'write', position,
 * data })`, the shape `StreamTargetChunk` already has), so nothing collects
 * the output in a Blob.
 *
 * The first failed write calls `onFailure`, and the export dialog aborts the
 * run with it: Mediabunny would only read a write's error at its next flush,
 * which can be the finalize, after the whole encode. The muxer itself is told
 * nothing (every write resolves, and those after the failure are dropped):
 * an error it read mid-encode would surface as an unhandled rejection in the
 * encoder's output callback rather than as the export's failure. `finish`
 * throws it, so a run that is not stopped in time still fails.
 */
export async function openFileSink(
  handle: FileSystemFileHandle,
  onFailure: (failure: FileWriteError) => void
): Promise<FileSink> {
  // Whether the picker made this file: only then is it removed on a discard.
  let wasEmpty = false;
  try {
    wasEmpty = (await handle.getFile()).size === 0;
  } catch {
    // Unreadable: leave it in place whatever happens.
  }
  let stream: FileSystemWritableFileStream;
  try {
    stream = await handle.createWritable();
  } catch (error) {
    throw fileWriteError(error, handle.name);
  }

  let failure: FileWriteError | null = null;
  let settled = false;
  const fail = (error: unknown): FileWriteError => {
    if (!failure) {
      failure = fileWriteError(error, handle.name);
      onFailure(failure);
    }
    return failure;
  };
  // Bytes handed to the file. A run that wrote none is not committed: the
  // exporters refuse an empty result anyway, and committing first would leave
  // an empty file behind that `discard` no longer removes.
  let written = 0;
  const finish = async (): Promise<Blob> => {
    if (failure) throw failure;
    if (written === 0) throw new Error('Export failed: no data was written to buffer');
    try {
      await stream.close();
    } catch (error) {
      throw fail(error);
    }
    settled = true;
    // The committed file: its bytes are on disk, not in the page's blob store.
    return handle.getFile();
  };

  return {
    name: handle.name,
    get failure() {
      return failure;
    },
    // Not the file's own stream: Mediabunny closes its target on finalize and
    // on cancel alike, and closing a file stream commits whatever it holds.
    // `finish` commits, and only a finished export reaches it.
    writable: new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        if (failure) return;
        try {
          await stream.write(chunk);
          written += chunk.data.byteLength;
        } catch (error) {
          fail(error);
        }
      },
    }),
    finish,
    async writeAll(blob) {
      try {
        await stream.write(blob);
        written += blob.size;
      } catch (error) {
        throw fail(error);
      }
      return finish();
    },
    async discard() {
      if (settled) return;
      settled = true;
      // The writes went to a copy the browser swaps in only on close; abort
      // deletes the copy.
      await stream.abort().catch(() => {});
      const { remove } = handle as FileSystemFileHandle & HandleExtras;
      if (wasEmpty && typeof remove === 'function') await remove.call(handle).catch(() => {});
    },
  };
}

/**
 * The handle each project file was opened through, where the open picker
 * gave one, so Save can write back to it. Keyed by the `File`, so a file that
 * arrived any other way (a drop, the `<input>` fallback) has none.
 */
const openedFrom = new WeakMap<File, FileSystemFileHandle>();

export function rememberFileHandle(file: File, handle: FileSystemFileHandle): void {
  openedFrom.set(file, handle);
}

export function fileHandleOf(file: File): FileSystemFileHandle | undefined {
  return openedFrom.get(file);
}
