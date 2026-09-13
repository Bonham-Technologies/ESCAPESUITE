// What the recorder screen does on the way in: ask the browser what it can
// capture, and load the recordings already in storage.
//
// Both live in ONE effect, as they did inline. Splitting them in two would
// change the order the store is written in on mount, which the capability
// rows and the recordings list both read.
import { useEffect } from 'react';
import { detectCapabilities } from '../core/permissions';
import type { DetailedCapabilities, EnvironmentCapabilities } from '../store/types';

/** The store actions the bootstrap writes through — App's, not a second subscription. */
export interface CapabilityBootstrapDeps {
  setCapabilities: (capabilities: EnvironmentCapabilities) => void;
  setDetailedCapabilities: (capabilities: DetailedCapabilities) => void;
  loadRecordings: () => Promise<void>;
}

export function useCapabilityBootstrap({
  setCapabilities,
  setDetailedCapabilities,
  loadRecordings,
}: CapabilityBootstrapDeps): void {
  // Detect capabilities on mount
  useEffect(() => {
    detectCapabilities().then((result) => {
      setCapabilities(result.capabilities);
      setDetailedCapabilities(result.detailed);
    });
    loadRecordings();
  }, [setCapabilities, setDetailedCapabilities, loadRecordings]);
}
