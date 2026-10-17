// Which saved session the startup prompt offers, and how a restored one
// changes hands (ESCSUITE-274).
//
// Every tab autosaves to a slot of its own and holds `escapeartist-tab:<id>`
// for its lifetime (`sessionLock.ts`), so a slot whose tab lock is free is the
// work of a tab that closed or crashed. The prompt offers this tab's own slot
// whenever it has one (a reload, or a tab the browser restored after a crash),
// and otherwise the newest of the free ones — claiming that slot's offer lock
// while the offer stands, so a second fresh tab opened with this one is offered
// the next slot or none rather than the same session (ESCSUITE-283).
// A slot is removed when it is restored (adopted by the restoring tab), when
// its own tab declines it (a reload) or the ownerless legacy row is declined,
// when its own tab starts a New Project, or here, at startup, once it is older
// than `SESSION_SLOT_MAX_AGE_MS`. Another tab's slot that is declined is left —
// its tab may only have been discarded and will come back for it — and that
// save is not offered to the declining tab again, a newer one is (ESCSUITE-306,
// `declinedSlots.ts`). An answer to the prompt
// reads the offered slot again first, so a slot saved again or removed since it
// was offered is neither deleted nor adopted on the old prompt's say (ESCSUITE-289).
import {
  clearSessionState,
  listSessionStates,
  saveSessionState,
  type SessionSlot,
} from '../core/storage';
import { claimOfferLock, NO_HOLD, probeTabLock } from './sessionLock';
import { readDeclinedSlots, type DeclinedSave } from './declinedSlots';
import { SESSION_SLOT_MAX_AGE_MS } from './appConstants';

/**
 * The slot the prompt offers, how to let go of the offer claimed for it once
 * the prompt is answered (`NO_HOLD` for this tab's own slot and the ownerless
 * legacy row, which nothing claims), and whether the tab that wrote it has
 * come back since — asked before either answer touches the slot, because the
 * prompt can stay up indefinitely and the departed tab can reload meanwhile.
 */
export interface OfferedSlot {
  slot: SessionSlot;
  release: () => void;
  ownerReturned: () => Promise<boolean>;
}

/** This tab's own slot and the legacy row: no other tab owns either. */
const NO_OWNER = (): Promise<boolean> => Promise.resolve(false);

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
 * between tabs without a probe or a claim, since no tab owns it, and every
 * other slot's tab lock probed, newest first, and its offer claimed once the
 * tab is found gone (ESCSUITE-283). The claim is held until the caller releases
 * it, so a second fresh tab asking at the same time finds the offer held and
 * moves on to the next slot; the tab lock is only probed, so the departed tab
 * coming back still finds its own id free.
 *
 * A slot still holding a save this tab has declined (`declined`, this tab's own
 * list by default; matched on tab id and `timestamp`) is skipped without a probe
 * or a claim (ESCSUITE-306): it was left in storage for a tab that may come back
 * for it, and this tab has already answered it. A newer save in the same slot is
 * offered again. The list never stands in the way of this tab's own slot, which
 * is chosen first.
 */
export async function findOfferableSlot(
  tabId: string,
  now: number,
  declined: readonly DeclinedSave[] = readDeclinedSlots()
): Promise<OfferedSlot | null> {
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
  if (own) return hasMedia(own) ? { slot: own, release: NO_HOLD, ownerReturned: NO_OWNER } : null;

  candidates.sort((a, b) => b.session.timestamp - a.session.timestamp);
  for (const slot of candidates) {
    const owner = slot.tabId;
    if (owner === null) return { slot, release: NO_HOLD, ownerReturned: NO_OWNER };
    const { timestamp } = slot.session;
    if (declined.some((save) => save.tabId === owner && save.timestamp === timestamp)) continue;
    if ((await probeTabLock(owner)) === 'held') continue;
    const release = await claimOfferLock(owner);
    if (release) {
      const ownerReturned = async () => (await probeTabLock(owner)) === 'held';
      return { slot, release, ownerReturned };
    }
  }
  return null;
}

/**
 * A restored slot becomes this tab's: written again under this tab's id and
 * stamped now — so the age limit counts from the restore, not from when the
 * departed tab last saved — then the old row deleted — in that order, so a failed write leaves the session
 * where it was rather than nowhere. A failure is logged, never thrown: the
 * restore itself has already landed, and the autosave writes this tab's slot
 * again from its next tick. Answers whether the old row is gone: while it is
 * not, the caller keeps its claim on the offer, so no other tab adopts a
 * second copy of it (ESCSUITE-283).
 */
export async function adoptSessionSlot(slot: SessionSlot, tabId: string): Promise<boolean> {
  try {
    await saveSessionState({ ...slot.session, tabId, timestamp: Date.now() });
    await clearSessionState(slot.tabId);
    return true;
  } catch (error) {
    console.error('Failed to adopt the restored session:', error);
    return false;
  }
}

/**
 * The offered slot as storage holds it when the prompt is answered
 * (ESCSUITE-289): `'unchanged'` when it still holds the save that was offered,
 * the slot as it is now when its tab has saved again since — come back, saved
 * newer work and closed again, so its lock is free once more and
 * `ownerReturned()` cannot tell — and `'removed'` when it is gone (its tab came
 * back and started fresh, or another window's answer took it). A slot is found
 * by its tab id, its row's key, and a save is told apart by its `timestamp`,
 * which every autosave stamps afresh.
 */
export type SlotAtAnswer = 'unchanged' | 'removed' | SessionSlot;

export async function slotAtAnswer(offered: SessionSlot): Promise<SlotAtAnswer> {
  const now = (await listSessionStates()).find((slot) => slot.tabId === offered.tabId);
  if (!now) return 'removed';
  return now.session.timestamp === offered.session.timestamp ? 'unchanged' : now;
}
