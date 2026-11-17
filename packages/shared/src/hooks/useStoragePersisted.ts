import { useEffect, useSyncExternalStore } from 'react'
import {
  getStoragePersisted,
  readStoragePersisted,
  subscribeStoragePersisted,
} from '../storage/persistence'

/**
 * Whether the browser has agreed to keep this origin's storage (ESCSUITE-468),
 * or null until the first read answers. Reads `navigator.storage.persisted()`
 * on mount, never asks; every component using it re-renders when a save's
 * `requestStoragePersistence()` re-reads the state.
 */
export function useStoragePersisted(): boolean | null {
  const persisted = useSyncExternalStore(subscribeStoragePersisted, getStoragePersisted, getStoragePersisted)
  useEffect(() => {
    void readStoragePersisted()
  }, [])
  return persisted
}
