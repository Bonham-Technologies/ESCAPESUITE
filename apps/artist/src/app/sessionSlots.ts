// Which saved session the startup prompt offers, and how a restored one
// changes hands (ESCSUITE-274).
//
// Every tab autosaves to a slot of its own and holds `escapeartist-tab:<id>`
// for its lifetime (`sessionLock.ts`), so a slot whose tab lock is free is the
// work of a tab that closed or crashed. The prompt offers the newest of those.
// A slot is removed when it is restored (adopted by the restoring tab), when
// it is declined, when its own tab starts a New Project, or here, at startup,
// once it is older than `SESSION_SLOT_MAX_AGE_MS`.
import {
  clearSessionState,
  listSessionStates,
  saveSessionState,
  type SessionSlot,
} from '../core/storage';
import { probeTabLock } from './sessionLock';
import { SESSION_SLOT_MAX_AGE_MS } from './appConstants';

/**
 * The newest slot with media in it whose tab is gone, or `null`; slots older
 * than the age limit are deleted on the way.
 *
 * Two slots are offered without asking after a lock: this tab's own — a reload
 * finds the slot it wrote before, and this tab is about to hold that lock
 * itself, so a probe would call it "held" — and the legacy row an older build
 * shared between tabs, which no tab owns. Every other slot's tab is probed,
 * newest first, until one is free.
 */
export async function findOfferableSlot(tabId: string, now: number): Promise<SessionSlot | null> {
  const cutoff = now - SESSION_SLOT_MAX_AGE_MS;
  const candidates: SessionSlot[] = [];
  for (const slot of await listSessionStates()) {
    if (slot.session.timestamp < cutoff) {
      // Not awaited: the prompt does not wait on housekeeping.
      clearSessionState(slot.tabId).catch((error: unknown) => {
        console.error('Failed to prune a session slot:', error);
      });
    } else if (slot.session.sourceVideos.length > 0) {
      candidates.push(slot);
    }
  }
  candidates.sort((a, b) => b.session.timestamp - a.session.timestamp);

  for (const slot of candidates) {
    if (slot.tabId === null || slot.tabId === tabId || (await probeTabLock(slot.tabId)) === 'free') {
      return slot;
    }
  }
  return null;
}

/**
 * A restored slot becomes this tab's: written again under this tab's id, then
 * the old row deleted — in that order, so a failed write leaves the session
 * where it was rather than nowhere. A failure is logged, never thrown: the
 * restore itself has already landed, and the autosave writes this tab's slot
 * again from its next tick.
 */
export async function adoptSessionSlot(slot: SessionSlot, tabId: string): Promise<void> {
  try {
    await saveSessionState({ ...slot.session, tabId });
    await clearSessionState(slot.tabId);
  } catch (error) {
    console.error('Failed to adopt the restored session:', error);
  }
}
