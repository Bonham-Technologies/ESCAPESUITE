/**
 * The worker that keeps a take on the device while it is being recorded
 * (ESCSUITE-466). See `takeStore.ts` for the page's half and
 * `docs/reference/crash-safe-takes.md` for the whole design.
 *
 * It exists because the one OPFS write that promises durability — a
 * `FileSystemSyncAccessHandle`, whose `flush()` "persists any changes made to
 * the file … via the write() method to disk" — is offered only inside a
 * dedicated worker. `createWritable()` on the page commits nothing until it is
 * closed, so a tab that dies mid-take would leave nothing behind it.
 *
 * Like the AudioWorklet processor (`audioWorkletCapture.ts`) it is a source
 * string started from a `blob:` URL: a single-file build has no file to serve
 * a worker from, and the hosted policy already admits `blob:` in `worker-src`.
 * Tests run the same string against an in-memory OPFS
 * (`src/test/doubles/opfs.ts`), so what they exercise is what ships.
 *
 * The protocol, one message at a time and in order (each waits for the one
 * before it, so a write can never overtake the `open` it depends on):
 *
 * - `{ op: 'open', root, takeId, journalName, journal }` creates
 *   `<root>/<takeId>/`, writes the journal through a sync handle, flushes and
 *   closes it, starts the flush timer and answers `{ op: 'opened' }` — or
 *   `{ op: 'error', message }` when any of that is refused. The page treats
 *   either answer as the whole feature check: nothing else can say whether
 *   this browser, profile and origin will hand out a sync access handle.
 * - `{ op: 'write', name, data, at? }` writes `data` (an `ArrayBuffer` or a
 *   `Blob`) into `name` at byte `at`, or after the furthest byte written so
 *   far when `at` is absent. The file and its handle are made on first use.
 * - `{ op: 'close' }` flushes and closes every handle and answers
 *   `{ op: 'closed', files, failed }` with a `File` for each data file.
 *
 * Every `FLUSH_INTERVAL_MS` the dirty handles are flushed. That interval is
 * the most a take can lose to a power cut; a tab that crashes or is closed
 * loses nothing that reached `write()`, because the bytes are already the
 * operating system's.
 *
 * A write or flush that throws (most likely the origin's quota) is reported
 * once as `{ op: 'failed', message }`, and every write after it is dropped:
 * a file with a hole in it is worse than one that simply stops.
 */

/** How often the worker flushes what it has written (ms). */
export const TAKE_FLUSH_INTERVAL_MS = 2000

export const TAKE_STORE_WORKER_SOURCE = `
const FLUSH_INTERVAL_MS = ${TAKE_FLUSH_INTERVAL_MS};
let dir = null;
const files = new Map();
let failed = false;
let timer = null;
let queue = Promise.resolve();

const describe = (error) => (error && error.name ? error.name + ': ' + error.message : String(error));

function fail(error) {
  if (failed) return;
  failed = true;
  self.postMessage({ op: 'failed', message: describe(error) });
}

async function fileFor(name) {
  let file = files.get(name);
  if (!file) {
    const handle = await dir.getFileHandle(name, { create: true });
    const access = await handle.createSyncAccessHandle();
    file = { handle, access, end: access.getSize(), dirty: false };
    files.set(name, file);
  }
  return file;
}

function flushAll() {
  for (const file of files.values()) {
    if (file.dirty) {
      file.access.flush();
      file.dirty = false;
    }
  }
}

async function open(message) {
  const root = await navigator.storage.getDirectory();
  const takes = await root.getDirectoryHandle(message.root, { create: true });
  dir = await takes.getDirectoryHandle(message.takeId, { create: true });
  const journal = await fileFor(message.journalName);
  // Safari before 17 shipped the draft API, whose getSize(), flush(),
  // truncate() and close() return promises: appends would land at NaN, i.e.
  // byte 0. Such a browser keeps nothing; the take records in memory.
  if (typeof journal.end !== 'number') {
    throw new Error('this browser has only the asynchronous sync access handle');
  }
  const bytes = new TextEncoder().encode(message.journal);
  journal.access.truncate(0);
  journal.access.write(bytes, { at: 0 });
  journal.access.flush();
  journal.access.close();
  files.delete(message.journalName);
  timer = setInterval(() => {
    queue = queue.then(() => {
      if (!failed) flushAll();
    }).catch(fail);
  }, FLUSH_INTERVAL_MS);
  self.postMessage({ op: 'opened' });
}

async function write(message) {
  if (failed) return;
  const file = await fileFor(message.name);
  const data = new Uint8Array(
    message.data instanceof Blob ? await message.data.arrayBuffer() : message.data
  );
  const at = message.at === undefined ? file.end : message.at;
  const written = file.access.write(data, { at });
  if (written !== data.byteLength) {
    throw new Error('Wrote ' + written + ' of ' + data.byteLength + ' bytes');
  }
  file.end = Math.max(file.end, at + data.byteLength);
  file.dirty = true;
}

async function close() {
  clearInterval(timer);
  const result = {};
  for (const [name, file] of files) {
    try {
      if (!failed) file.access.flush();
    } catch (error) {
      fail(error);
    }
    file.access.close();
    result[name] = await file.handle.getFile();
  }
  files.clear();
  self.postMessage({ op: 'closed', files: result, failed });
}

self.onmessage = (event) => {
  const message = event.data;
  queue = queue.then(() => {
    if (message.op === 'open') return open(message);
    if (message.op === 'write') return write(message);
    return close();
  }).catch((error) => {
    if (message.op === 'open') {
      clearInterval(timer);
      failed = true;
      self.postMessage({ op: 'error', message: describe(error) });
    } else if (message.op === 'close') {
      self.postMessage({ op: 'closed', files: {}, failed: true, message: describe(error) });
    } else {
      fail(error);
    }
  });
};
`
