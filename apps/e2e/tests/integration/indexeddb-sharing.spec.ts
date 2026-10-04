import { test } from '@playwright/test'
import { waitForIndexedDB } from '../../utils/indexeddb'
import { waitForAppReady } from '../../utils/ready'

const DB_NAME = 'video-editor-db'

// Note: In development, CRAFT (5174) and ARTIST (5175) run on different
// origins, so IndexedDB is NOT shared — each app's browser storage partition
// gets its own, separate `video-editor-db`. The real cross-app sharing (one
// database, one origin, a record written by one app read by the other) can
// only be proved on the combined production layout; it lives, un-skipped, in
// tests/production/indexeddb-sharing.spec.ts (`pnpm test:e2e:production`).
//
// What *is* true here is narrower but still real: both apps open a database
// under the same name — `packages/shared/src/storage`'s one `DB_NAME`
// constant, imported by both — on an ordinary load with no params. The test
// below proves that each app's own storage layer actually reaches that open
// call, not just that the source names the right constant.
//
// The file used to also carry three tests that opened `video-editor-db`
// directly with hand-rolled schemas ("video blob stored and retrieved
// correctly", "large blobs can be stored", "database upgrades handled
// correctly") and one ("both apps can access database simultaneously") that
// asserted only `<div id="root">` after two unrelated page loads. None of the
// four ever called into either app's code: the blob/upgrade tests exercised
// the browser's IndexedDB engine directly (and the "upgrade" test never
// actually opened a second version to upgrade *to* — it always resolved
// `true`), and the "simultaneously" test had nothing in it for either app to
// contend over. All four are deleted rather than kept as placeholders —
// the browser's IndexedDB implementation is not this app.

test.describe('IndexedDB Data Sharing', () => {
  test('both apps open a database of the same name', async ({ browser }) => {
    const context = await browser.newContext()

    const craftPage = await context.newPage()
    await craftPage.goto('http://localhost:5174')
    await waitForAppReady(craftPage, 'craft')
    // The app opens the database on mount; poll rather than sample once.
    await waitForIndexedDB(craftPage, DB_NAME)

    const artistPage = await context.newPage()
    await artistPage.goto('http://localhost:5175')
    await waitForAppReady(artistPage, 'artist')
    // ARTIST's session-restore check (app/useSessionRestore.ts) opens the
    // same database on an ordinary load with no `?suppressRestore=1`.
    await waitForIndexedDB(artistPage, DB_NAME)

    await context.close()
  })
})
