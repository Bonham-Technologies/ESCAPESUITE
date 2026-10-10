// The keys `PlaybackControls`' window listener binds, as the shortcut sheet
// labels them. Pinned against the sheet by `KeyboardShortcuts.test.tsx`
// (ESCSUITE-247); add a key here when the transport binds one. Kept out of the
// component file so that file exports components only.
export const TRANSPORT_KEYS: readonly string[] = ['Space', '←', '→', 'Home', 'End'];
