# ESCAPECRAFT Recording Pipeline Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ESCAPECRAFT recordings seekable, performant, and instant to download by using WebCodecs for non-PiP modes and fixing PiP's double-capture bug.

**Architecture:** Three-pronged approach: (1) Fix the double `captureStream` in PiP mode to halve capture cost, (2) Re-enable the existing WebCodecsRecorder for screen-only and webcam-only modes so recordings produce seekable WebM at record time, (3) For PiP mode (which must use MediaRecorder), add a `getOutputStream()` method to compositor to avoid duplicate streams. The recorder factory decides which recorder to use based on mode, not just browser capability.

**Tech Stack:** WebCodecs API, MediaRecorder API, Mediabunny (muxing), webm-duration-fix, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/craft/src/core/compositor.ts` | Modify | Add `getOutputStream()` to return the single captured stream |
| `apps/craft/src/core/recorder-factory.ts` | Modify | Accept recording mode, use WebCodecs for non-PiP, MediaRecorder for PiP |
| `apps/craft/src/core/webcodecs-recorder.ts` | Modify | Use `requestVideoFrameCallback` instead of `MediaStreamTrackProcessor` |
| `apps/craft/src/App.tsx` | Modify | Remove double `captureStream`, pass mode to factory, simplify save |
| `apps/craft/src/core/recorder-factory.test.ts` | Modify | Update tests for mode-based selection |
| `apps/craft/src/core/webcodecs-recorder.test.ts` | Modify | Update tests for new frame capture method |
| `apps/craft/src/core/compositor.test.ts` | Modify | Add test for `getOutputStream()` |

---

### Task 1: Fix Double captureStream in PiP Compositor

The compositor creates a stream via `canvas.captureStream(30)` in `start()`, then App.tsx calls `getCanvas().captureStream(30)` again for recording. This doubles the capture cost. Fix by exposing the already-captured stream.

**Files:**
- Modify: `apps/craft/src/core/compositor.ts:105-111`
- Modify: `apps/craft/src/App.tsx:475-482`
- Test: `apps/craft/src/core/compositor.test.ts`

- [ ] **Step 1: Add `getOutputStream()` to compositor**

In `apps/craft/src/core/compositor.ts`, add a method after `getCanvas()`:

```typescript
/**
 * Get the output MediaStream (created by start()).
 * Reuse this for both preview and recording instead of calling captureStream() again.
 */
getOutputStream(): MediaStream | null {
  return this.outputStream;
}
```

- [ ] **Step 2: Update App.tsx to reuse compositor stream for recording**

In `apps/craft/src/App.tsx`, replace the double-captureStream block (lines ~475-482):

```typescript
// BEFORE (creates second captureStream):
recordingScreen = new MediaStream([
  ...compositorRef.current.getCanvas().captureStream(30).getVideoTracks(),
  ...(screen?.getAudioTracks() || []),
]);

// AFTER (reuses existing stream):
const compositorStream = compositorRef.current.getOutputStream();
if (compositorStream) {
  recordingScreen = new MediaStream([
    ...compositorStream.getVideoTracks(),
    ...(screen?.getAudioTracks() || []),
  ]);
}
```

- [ ] **Step 3: Write test for getOutputStream**

In `apps/craft/src/core/compositor.test.ts`, add:

```typescript
it('should return the output stream from getOutputStream', () => {
  // getOutputStream returns null before start
  expect(compositor.getOutputStream()).toBeNull();

  // After start, returns the captured stream
  const stream = compositor.start(30);
  expect(compositor.getOutputStream()).toBe(stream);
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --filter=@escapesuite/craft -- compositor`
Expected: All compositor tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/craft/src/core/compositor.ts apps/craft/src/core/compositor.test.ts apps/craft/src/App.tsx
git commit -m "fix(craft): eliminate double captureStream in PiP mode"
```

---

### Task 2: Update Recorder Factory to Accept Recording Mode

The factory currently returns `false` from `canUseWebCodecsRecorder()` unconditionally. Change it to accept a mode parameter — WebCodecs works for screen-only and webcam-only (where the video element is visible/attached to DOM), it only fails in PiP mode where frame capture from the compositor's hidden video elements was unreliable.

**Files:**
- Modify: `apps/craft/src/core/recorder-factory.ts`
- Test: `apps/craft/src/core/recorder-factory.test.ts`

- [ ] **Step 1: Update factory to accept isPiP parameter**

Replace `apps/craft/src/core/recorder-factory.ts`:

```typescript
import { Recorder, type RecorderCallbacks } from './recorder';
import { WebCodecsRecorder, isWebCodecsRecordingSupported, type WebCodecsRecorderCallbacks } from './webcodecs-recorder';

export type AnyRecorder = Recorder | WebCodecsRecorder;
export type AnyRecorderCallbacks = RecorderCallbacks | WebCodecsRecorderCallbacks;

/**
 * Check if WebCodecs-based recording can be used for the given mode.
 *
 * WebCodecs recording produces seekable WebM with proper keyframes and Cues.
 * It works reliably for screen-only and webcam-only modes where the video
 * source is a direct stream (not a compositor canvas).
 *
 * PiP mode uses MediaRecorder because the compositor's hidden video elements
 * cause frame capture issues with WebCodecs (browsers optimize away decoding
 * for non-visible elements).
 */
export function canUseWebCodecsRecorder(isPiP: boolean = false): boolean {
  if (isPiP) return false; // PiP requires MediaRecorder due to compositor
  return isWebCodecsRecordingSupported();
}

/**
 * Create the best available recorder for the given mode.
 * @param callbacks - Recorder event callbacks
 * @param isPiP - Whether PiP mode is active (forces MediaRecorder)
 */
export function createRecorder(callbacks: AnyRecorderCallbacks, isPiP: boolean = false): AnyRecorder {
  if (canUseWebCodecsRecorder(isPiP)) {
    console.log('Using WebCodecs-based recorder (seekable output)');
    return new WebCodecsRecorder(callbacks);
  } else {
    console.log(`Using MediaRecorder-based recorder${isPiP ? ' (PiP mode)' : ''}`);
    return new Recorder(callbacks);
  }
}

export function getRecorderType(isPiP: boolean = false): 'webcodecs' | 'mediarecorder' {
  return canUseWebCodecsRecorder(isPiP) ? 'webcodecs' : 'mediarecorder';
}
```

- [ ] **Step 2: Update factory tests**

Replace `apps/craft/src/core/recorder-factory.test.ts` tests:

```typescript
describe('canUseWebCodecsRecorder', () => {
  it('should return false for PiP mode even when WebCodecs is available', () => {
    expect(canUseWebCodecsRecorder(true)).toBe(false);
  });

  it('should return true for non-PiP mode when WebCodecs is available', () => {
    expect(canUseWebCodecsRecorder(false)).toBe(true);
  });

  it('should return true by default (non-PiP)', () => {
    expect(canUseWebCodecsRecorder()).toBe(true);
  });
});

describe('getRecorderType', () => {
  it('should return webcodecs for non-PiP mode', () => {
    expect(getRecorderType(false)).toBe('webcodecs');
  });

  it('should return mediarecorder for PiP mode', () => {
    expect(getRecorderType(true)).toBe('mediarecorder');
  });
});

describe('createRecorder', () => {
  const callbacks = {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onError: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create WebCodecsRecorder for non-PiP mode', () => {
    const recorder = createRecorder(callbacks, false);
    expect(recorder).toBeInstanceOf(WebCodecsRecorder);
    recorder.dispose();
  });

  it('should create Recorder for PiP mode', () => {
    const recorder = createRecorder(callbacks, true);
    expect(recorder).toBeInstanceOf(Recorder);
    recorder.dispose();
  });
});
```

Also update the "without WebCodecs" describe block to test that non-PiP falls back to MediaRecorder when WebCodecs APIs are missing.

- [ ] **Step 3: Run tests**

Run: `pnpm test --filter=@escapesuite/craft -- recorder-factory`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/craft/src/core/recorder-factory.ts apps/craft/src/core/recorder-factory.test.ts
git commit -m "feat(craft): mode-based recorder selection — WebCodecs for non-PiP"
```

---

### Task 3: Fix WebCodecsRecorder Frame Capture

The WebCodecsRecorder disabled `MediaStreamTrackProcessor` (line 132) and falls back to a video element + canvas approach. The video element uses `visibility:hidden` (line 147) which is correct for keeping frames decoded. The actual problem was that in PiP mode the *compositor's* hidden video elements froze — but for non-PiP, the source stream comes directly from `getDisplayMedia`/`getUserMedia`, not from a hidden element.

The `requestVideoFrameCallback` path (line 437) is the best approach and is already implemented. We just need to ensure it uses the right video element positioning for reliable decoding.

**Files:**
- Modify: `apps/craft/src/core/webcodecs-recorder.ts:140-156`
- Test: `apps/craft/src/core/webcodecs-recorder.test.ts`

- [ ] **Step 1: Fix video element frame capture approach**

In `apps/craft/src/core/webcodecs-recorder.ts`, update the `initialize` method's video element setup (lines 140-156). The video element must be in the DOM with actual dimensions (not `display:none`) for the browser to decode frames. The current `visibility:hidden` approach is correct. Just re-enable it by removing the `hasTrackProcessor` override:

```typescript
// Replace line 132:
const hasTrackProcessor = false; // Disabled for now - see comment above

// With:
const hasTrackProcessor = typeof MediaStreamTrackProcessor !== 'undefined';
```

This re-enables `MediaStreamTrackProcessor` when available (Chrome 94+). For screen/webcam streams (not PiP compositor streams), `MediaStreamTrackProcessor` works reliably because the video frames come directly from the capture API, not from a hidden video element.

Also add a clarifying comment above that line:

```typescript
// Safe to re-enable: WebCodecsRecorder is only used for non-PiP modes (factory enforces this).
// The original PiP frame capture issue (PR #93) was caused by the compositor's hidden video
// elements, not by MediaStreamTrackProcessor itself. For direct screen/webcam streams, it works.
const hasTrackProcessor = typeof MediaStreamTrackProcessor !== 'undefined';
```

**Note on file size:** 1-second keyframes increase file size by ~20-40% vs 2-second. This is acceptable for screen recording (content compresses well) and matches ARTIST's export settings.

- [ ] **Step 2: Increase keyframe frequency to every 1 second**

In `webcodecs-recorder.ts`, change keyframe interval from 2 seconds to 1 second for better seeking. In both `startTrackProcessorCapture` (line 408) and `startVideoElementCapture` (lines 454, 494):

```typescript
// BEFORE:
const keyFrame = this.frameCount % (this.frameRate * 2) === 0;

// AFTER:
const keyFrame = this.frameCount % this.frameRate === 0; // Keyframe every 1 second
```

- [ ] **Step 3: Run WebCodecs recorder tests**

Run: `pnpm test --filter=@escapesuite/craft -- webcodecs-recorder`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/craft/src/core/webcodecs-recorder.ts apps/craft/src/core/webcodecs-recorder.test.ts
git commit -m "fix(craft): re-enable MediaStreamTrackProcessor, 1s keyframe interval"
```

---

### Task 4: Wire Mode-Based Recording in App.tsx

Update the recording flow in App.tsx to:
1. Determine if we're in PiP mode
2. Pass `isPiP` to `createRecorder`
3. For non-PiP WebCodecs recordings, skip `fixWebMMetadata` in save (output is already seekable)
4. Use compositor's `getOutputStream()` instead of double `captureStream`

**Files:**
- Modify: `apps/craft/src/App.tsx:432-486` (recording setup)
- Modify: `apps/craft/src/App.tsx:286-300` (save pipeline)

- [ ] **Step 1: Pass isPiP to createRecorder**

In `apps/craft/src/App.tsx`, update the recording setup block (~line 432):

```typescript
// Determine recording mode
const isPiP = config.screenEnabled && config.webcamEnabled && !!compositorRef.current;

// Initialize recorder — WebCodecs for non-PiP (seekable output), MediaRecorder for PiP
recorderRef.current = createRecorder({
  // ... callbacks stay the same
}, isPiP);
```

- [ ] **Step 2: Track recorder type for save pipeline**

Add a ref to track whether the current recording used WebCodecs (seekable output) or MediaRecorder (needs post-processing):

```typescript
const recorderTypeRef = useRef<'webcodecs' | 'mediarecorder'>('mediarecorder');
```

Set it after creating the recorder:

```typescript
recorderTypeRef.current = getRecorderType(isPiP);
```

Import `getRecorderType` from recorder-factory.

- [ ] **Step 2b: Await stop() for WebCodecsRecorder compatibility**

In `apps/craft/src/App.tsx`, find `handleStopRecording` (~line 239). `WebCodecsRecorder.stop()` is async (flushes encoders), while `Recorder.stop()` is sync. Add `await` so both work:

```typescript
// BEFORE:
recorderRef.current.stop();

// AFTER:
await recorderRef.current.stop();
```

Awaiting a sync `void` return is harmless, so this works for both recorder types.

- [ ] **Step 3: Conditional metadata fix in save pipeline**

In `saveRecording`, only run `fixWebMMetadata` for MediaRecorder output:

```typescript
let blob: Blob;
if (recorderTypeRef.current === 'webcodecs') {
  // WebCodecs output is already a proper WebM with Cues — no fix needed
  blob = rawBlob;
} else {
  // MediaRecorder output needs duration/Cues metadata fix
  try {
    blob = await fixWebMMetadata(rawBlob);
  } catch {
    blob = rawBlob;
  }
}
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm test --filter=@escapesuite/craft`
Expected: All 165 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/craft/src/App.tsx
git commit -m "feat(craft): use WebCodecs for non-PiP recording, skip metadata fix for seekable output"
```

---

### Task 5: Clean Up Unused Download Options and Conversion State

The MP4 and Compatible WebM download handlers (`handleDownloadMP4`, `handleDownloadWebMCompatible`) are dead code since we removed the download menu. Clean up all related state, imports, and UI.

**Files:**
- Modify: `apps/craft/src/App.tsx` — remove dead handlers, state, imports

- [ ] **Step 1: Remove dead state, refs, handlers, and effects**

Remove these exact items from `apps/craft/src/App.tsx`:

**State declarations (~lines 61-64):**
- `const [downloadMenuOpen, setDownloadMenuOpen] = useState<string | null>(null);`
- `const [downloadMenuPosition, setDownloadMenuPosition] = useState<{ top: number; left: number } | null>(null);`

**Refs:**
- `conversionAbortRef` ref declaration

**The click-outside useEffect (~lines 153-167):** This effect watches `downloadMenuOpen` and closes the menu on outside clicks. Remove the entire `useEffect` block.

**Dead handler functions:**
- `handleDownloadMP4` function (entire block)
- `handleDownloadWebMCompatible` function (entire block)
- `handleCancelConversion` function (entire block)

**Import cleanup (line 18):** Remove unused imports from converter.ts:
```typescript
// BEFORE:
import { convertToMP4, fixWebMMetadata, remuxToWebM, isMP4ConversionSupported, isWebMRemuxSupported, ConversionAbortedError, type ConversionProgress } from './core/converter';

// AFTER:
import { fixWebMMetadata } from './core/converter';
```

Note: `remuxToWebM` and `isWebMRemuxSupported` are no longer used since we moved PiP re-encoding out of the download/save path. `fixWebMMetadata` is still needed for MediaRecorder output in the save pipeline.

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm lint --filter=@escapesuite/craft && cd apps/craft && pnpm build`
Expected: No errors (unused variable warnings are OK)

- [ ] **Step 3: Run full test suite**

Run: `pnpm test --filter=@escapesuite/craft`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/craft/src/App.tsx
git commit -m "chore(craft): remove dead download conversion handlers and state"
```

---

### Task 6: Integration Test — Full Recording Pipeline

Manual testing checklist to verify the refactored pipeline works end-to-end.

- [ ] **Step 1: Test screen-only recording (WebCodecs path)**

1. Start CRAFT: `pnpm dev:craft`
2. Select screen-only mode (no webcam)
3. Record for 15-30 seconds
4. Stop recording
5. Verify: "Saving..." clears quickly (no metadata fix needed)
6. Click Play — verify preview plays and **seeking works** (click timeline to jump)
7. Click Download — verify downloaded `.webm` opens in Chrome with working seeking
8. Verify downloaded file plays in VLC with seeking

- [ ] **Step 2: Test webcam-only recording (WebCodecs path)**

1. Select webcam-only mode
2. Record for 15-30 seconds
3. Repeat same verification as Step 1

- [ ] **Step 3: Test PiP recording (MediaRecorder path)**

1. Select PiP mode (screen + webcam)
2. Record for 15-30 seconds
3. Verify: recording doesn't lag/freeze (double captureStream fixed)
4. Stop recording
5. Verify: "Saving..." appears (metadata fix runs)
6. Click Play — verify preview plays (seeking may be coarser — keyframe-level)
7. Click Download — verify file plays in VLC

- [ ] **Step 4: Test Send to Editor**

1. Record in any mode
2. Click "Open in Editor"
3. Verify ARTIST opens with the recording loaded

- [ ] **Step 5: Commit all verified changes**

```bash
git add -A
git commit -m "feat(craft): recording pipeline refactor — seekable output, PiP performance fix

- WebCodecs recorder for screen-only and webcam-only modes (seekable WebM)
- MediaRecorder for PiP mode (with metadata fix in save pipeline)
- Fix double captureStream in PiP (compositor.getOutputStream())
- Re-enable MediaStreamTrackProcessor for direct frame capture
- 1-second keyframe interval for smooth seeking
- Remove dead MP4/Compatible WebM download handlers"
```

---

## Risk Notes

1. **MediaStreamTrackProcessor re-enable**: This was disabled in PR #93 due to PiP issues. We're only re-enabling for non-PiP modes. If frame capture still freezes for screen-only mode, the fallback path (video element + canvas + requestVideoFrameCallback) is still there and works.

2. **WebCodecsRecorder stop is async**: `WebCodecsRecorder.stop()` returns a Promise (flushes encoders), while `Recorder.stop()` is synchronous. The `onStop` callback is used by both, so this shouldn't matter, but verify the App.tsx `handleStopRecording` flow handles both.

3. **Test coverage**: The existing `webcodecs-recorder.test.ts` mocks all WebCodecs APIs. The real validation is the manual integration test in Task 6.
