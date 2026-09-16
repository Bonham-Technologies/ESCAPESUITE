---
'@escapesuite/shared': patch
---

Modal keyboard behaviour lives in one place: `useDialogBehaviour`, exported as
`@escapesuite/shared/hooks`. It moved out of ESCAPECRAFT — where it had been lifted from
ESCAPEARTIST's export dialog — so all three dialogs in the suite share it, and gained an
optional `isOpen` argument for a dialog that stays mounted while closed.
