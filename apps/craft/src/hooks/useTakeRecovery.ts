// The prompt for takes that never finished (ESCSUITE-466): find them when the
// app opens and whenever a take of this tab is left on disk, offer the oldest
// one while the app is idle, and recover, discard or set it aside on the
// user's word. The bytes side lives in `core/takeStore.ts` and
// `core/takeRecovery.ts`; this hook only sequences them against the app's
// state and its one notice channel.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  discardUnfinishedTake,
  findUnfinishedTakes,
  NothingToRecoverError,
  repairUnfinishedTake,
  withTakeClaimed,
  type UnfinishedTake,
} from '../core/takeRecovery';
import { onTakeKept } from '../core/takeStore';
import { NOT_SEEKABLE, NOTHING_TO_RECOVER, RECOVERY_FAILED } from '../utils/notices';
import type { RecordingState } from '../store/types';
import type { SaveRecording } from './useRecordingSave';

export interface TakeRecoveryDeps {
  state: RecordingState;
  saveRecording: SaveRecording;
  setState: (state: RecordingState) => void;
  setNotice: (notice: string | null) => void;
  refreshStorageSpace: () => Promise<void>;
}

export interface TakeRecovery {
  /**
   * The take to offer now, or null. Only while the app is idle: a take that
   * died is not a reason to interrupt one that is recording, and the prompt
   * waits for the next idle moment instead.
   */
  pendingTake: UnfinishedTake | null;
  recover: () => Promise<void>;
  discard: () => Promise<void>;
  /** Not now: ask again the next time CRAFT opens. */
  dismiss: () => void;
}

export function useTakeRecovery({
  state,
  saveRecording,
  setState,
  setNotice,
  refreshStorageSpace,
}: TakeRecoveryDeps): TakeRecovery {
  const [takes, setTakes] = useState<UnfinishedTake[]>([]);
  // Set aside for this visit: dismissed, or tried and failed.
  const [setAside, setSetAside] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  const scan = useCallback(() => {
    void findUnfinishedTakes().then((found) => {
      if (mountedRef.current) setTakes(found);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    scan();
    const unsubscribe = onTakeKept(scan);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [scan]);

  const pendingTake =
    state === 'idle' ? (takes.find((t) => !setAside.has(t.journal.takeId)) ?? null) : null;

  const forget = (take: UnfinishedTake) => {
    setTakes((current) => current.filter((t) => t !== take));
  };

  const putAside = (take: UnfinishedTake) => {
    setSetAside((current) => new Set(current).add(take.journal.takeId));
  };

  const recover = async () => {
    const take = pendingTake;
    if (!take || busyRef.current) return;
    busyRef.current = true;
    setState('saving');
    try {
      // Unclaimed — another tab is on it — runs nothing, and whatever that tab
      // decides, this one has nothing left to offer.
      await withTakeClaimed(take, async () => {
        let recovered;
        try {
          recovered = await repairUnfinishedTake(take);
        } catch (error) {
          if (!(error instanceof NothingToRecoverError)) throw error;
          await discardUnfinishedTake(take);
          setNotice(NOTHING_TO_RECOVER);
          return;
        }
        const { journal } = recovered;
        await saveRecording(
          recovered.blob,
          recovered.duration,
          recovered.companions.length > 0 ? recovered.companions : null,
          journal.captured,
          { createdAt: journal.startedAt, systemAudioShared: journal.systemAudioShared }
        );
        // Stored: the copy on disk has done its job.
        await discardUnfinishedTake(take);
        if (!recovered.seekable) setNotice(NOT_SEEKABLE);
      });
      forget(take);
    } catch (error) {
      console.error('The unfinished recording could not be recovered:', error);
      setNotice(RECOVERY_FAILED);
      putAside(take);
    } finally {
      busyRef.current = false;
      setState('idle');
      void refreshStorageSpace();
    }
  };

  const discard = async () => {
    const take = pendingTake;
    if (!take || busyRef.current) return;
    busyRef.current = true;
    try {
      await withTakeClaimed(take, () => discardUnfinishedTake(take));
      forget(take);
    } finally {
      busyRef.current = false;
      void refreshStorageSpace();
    }
  };

  const dismiss = () => {
    if (pendingTake) putAside(pendingTake);
  };

  return { pendingTake, recover, discard, dismiss };
}
