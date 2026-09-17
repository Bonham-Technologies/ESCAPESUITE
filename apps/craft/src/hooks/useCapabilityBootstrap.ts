// What the recorder screen does on the way in: ask the browser what it can
// capture, and load the recordings already in storage.
//
// Both live in ONE effect, as they did inline. Splitting them in two would
// change the order the store is written in on mount, which the capability
// rows and the recordings list both read.
import { useEffect } from 'react';
import { detectCapabilities } from '../core/permissions';
import { probeMP4Support } from '../core/converter';
import { DETECTION_FAILED, LIBRARY_UNREADABLE } from '../utils/notices';
import type {
  DetailedCapabilities,
  EnvironmentCapabilities,
  Mp4Support,
} from '../store/types';

/** The store actions the bootstrap writes through — App's, not a second subscription. */
export interface CapabilityBootstrapDeps {
  setCapabilities: (capabilities: EnvironmentCapabilities) => void;
  setDetailedCapabilities: (capabilities: DetailedCapabilities) => void;
  /** Raised once detection has answered — the Record button is dead until then. */
  setCapabilitiesReady: (ready: boolean) => void;
  /**
   * Where the MP4 codec probe's answer goes. Asked here, on the way in, for
   * the same reason the storage headroom is measured here: the MP4 button must
   * know before the click, not await an answer on it.
   */
  setMp4Support: (support: Mp4Support) => void;
  /** The one notice channel — see utils/notices.ts. */
  setNotice: (notice: string | null) => void;
  loadRecordings: () => Promise<void>;
  /**
   * Measure the storage headroom into the store. Done here, on the way in,
   * precisely so the Record button never has to await it on the click path.
   */
  refreshStorageSpace: () => Promise<void>;
}

export function useCapabilityBootstrap({
  setCapabilities,
  setDetailedCapabilities,
  setCapabilitiesReady,
  setMp4Support,
  setNotice,
  loadRecordings,
  refreshStorageSpace,
}: CapabilityBootstrapDeps): void {
  // Detect capabilities on mount
  useEffect(() => {
    detectCapabilities().then((result) => {
      setCapabilities(result.capabilities);
      setDetailedCapabilities(result.detailed);
      setCapabilitiesReady(true);
    }).catch((error: unknown) => {
      // Detection itself failing must not strand the app with a permanently
      // dead Record button: the capabilities stay all-false, so the button
      // still refuses a take it cannot serve, but it refuses with a reason
      // rather than with "Checking...".
      console.error('Capability detection failed:', error);
      setNotice(DETECTION_FAILED);
      setCapabilitiesReady(true);
    });
    // An unhandled rejection here — private mode, blocked storage — used to
    // leave the library silently empty, indistinguishable from "no recordings
    // yet".
    loadRecordings().catch((error: unknown) => {
      console.error('Failed to load recordings:', error);
      setNotice(LIBRARY_UNREADABLE);
    });
    // Never rejects — see the store action.
    void refreshStorageSpace();
    // Does this browser actually have an H.264 and an AAC encoder behind its
    // WebCodecs? Asked once — the probe memoises — and never rejects: a probe
    // that could not answer resolves as "no", with a reason, so the button
    // leaves "Checking..." whatever happens.
    void probeMP4Support().then((support) => {
      setMp4Support({ state: 'ready', ...support });
    });
  }, [
    setCapabilities,
    setDetailedCapabilities,
    setCapabilitiesReady,
    setMp4Support,
    setNotice,
    loadRecordings,
    refreshStorageSpace,
  ]);
}
