import type { ComponentType } from 'react'
import { Privacy, Terms } from './pages/Legal'
import Limitations from './pages/Limitations/Limitations'

/**
 * The hub's pages besides Home (which is the index route), in the order
 * `App.tsx` registers them. The single list of hub routes: `routes.test.ts`
 * checks that `vercel.json` rewrites exactly `HUB_PATHS` to the hub, so a page
 * added here without its rewrite (or the reverse) fails a test. Any other path
 * is a 404 on the hosted site and shows the not-found page (ESCSUITE-455).
 */
export const PAGES: ReadonlyArray<{ path: string; Page: ComponentType }> = [
  { path: 'privacy', Page: Privacy },
  { path: 'terms', Page: Terms },
  { path: 'limitations', Page: Limitations },
]

/** Every path the hub serves, as `vercel.json` lists them. */
export const HUB_PATHS: readonly string[] = ['/', ...PAGES.map(({ path }) => `/${path}`)]
