// Which saved session the startup prompt offers, and how a restored one
// changes hands (ESCSUITE-274).
//
// Every tab autosaves to a slot of its own and holds `escapeartist-tab:<id>`
// for its lifetime (`sessionLock.ts`), so a slot whose tab lock is free is the
// work of a tab that closed or crashed. The prompt offers this tab's own slot
// whenever it has one (a reload, or a tab the browser restored after a crash),
// and otherwise the newest of the free ones — claiming that tab's lock while
// the offer stands, so a second fresh tab opened with this one is offered the
// next slot or none rather than the same session (ESCSUITE-283).
// A slot is removed when it is restored (adopted by the restoring tab), when
// it is declined, when its own tab starts a New Project, or here, at startup,
// once it is older than `SESSION_SLOT_MAX_AGE_MS`.
import {
  clearSessionState,
  listSessionStates,
  saveSessionState,
  type SessionSlot,
} from '../core/storage';
import { claimTabLock, NO_HOLD } from './sessionLock';
import { SESSION_SLOT_MAX_AGE_MS } from './appConstants';

/**
 * The slot the prompt offers, and how to let go of the departed tab's lock
 * claimed for it once the prompt is answered (`NO_HOLD` for this tab's own
 * slot and the ownerless legacy row, which nothing claims).
 */
export interface OfferedSlot {
  slot: SessionSlot;
  release: () => void;
}

const hasMedia = (slot: SessionSlot): boolean => slot.session.sourceVideos.length > 0;

/**
 * The slot the prompt offers, or `null`; slots older than the age limit are
 * deleted on the way.
 *
 * **This tab's own slot comes first** whenever it exists (fix round 1): it is
 * this tab's own session after a reload or a browser crash-restore — tabs the
 * browser brings back start together, before any has its lock again, so each
 * finds every other's slot free — and offering another tab's newer slot over
 * it would lose it either way: a restore adopts over it, a decline leaves it
 * for this tab's next edit to overwrite. It is offered without a probe (this
 * tab is about to hold that lock itself, so a probe would call it "held"), and
 * an own slot with no media in it offers nothing rather than another slot.
 *
 * Only a tab with no slot of its own is offered someone else's: the newest
 * slot with media whose tab is gone — the legacy row an older build shared
 * between tabs without a claim, since no tab owns it, and every other slot's
 * tab lock claimed, newest first, until one is taken (ESCSUITE-283). The claim
 * is held until the caller releases it, so a second fresh tab asking at the
 * same time finds that lock held and moves on to the next slot.
 */
export async function findOfferableSlot(tabId: string, now: number): Promise<OfferedSlot | null> {
  const cutoff = now - SESSION_SLOT_MAX_AGE_MS;
  const candidates: SessionSlot[] = [];
  let own: SessionSlot | undefined;
  for (const slot of await listSessionStates()) {
    if (slot.session.timestamp < cutoff) {
      // Not awaited: the prompt does not wait on housekeeping.
      clearSessionState(slot.tabId).catch((error: unknown) => {
        console.error('Failed to prune a session slot:', error);
      });
    } else if (slot.tabId === tabId) {
      own = slot;
    } else if (hasMedia(slot)) {
      candidates.push(slot);
    }
  }
  if (own) return hasMedia(own) ? { slot: own, release: NO_HOLD } : null;

  candidates.sort((a, b) => b.session.timestamp - a.session.timestamp);
  for (const slot of candidates) {
    if (slot.tabId === null) return { slot, release: NO_HOLD };
    const release = await claimTabLock(slot.tabId);
    if (release) return { slot, release };
  }
  return null;
}

/**
 * A restored slot becomes this tab's: written again under this tab's id and
 * stamped now — so the age limit counts from the restore, not from when the
 * departed tab last saved — then the old row deleted — in that order, so a failed write leaves the session
 * where it was rather than nowhere. A failure is logged, never thrown: the
 * restore itself has already landed, and the autosave writes this tab's slot
 * again from its next tick.
 */
export async function adoptSessionSlot(slot: SessionSlot, tabId: string): Promise<void> {
  try {
    await saveSessionState({ ...slot.session, tabId, timestamp: Date.now() });
    await clearSessionState(slot.tabId);
  } catch (error) {
    console.error('Failed to adopt the restored session:', error);
  }
}
