<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Responsive Inspector (`src/app/InspectorSidebar.tsx`, `src/app/MobileInspectorToggle.tsx`, `src/App.module.css`)
The inspector panel (ClipEditor) adapts to different screen sizes. `App.tsx` owns the
`inspectorCollapsed` flag and hands it to both components; the markup lives in
`src/app/InspectorSidebar.tsx` (the sidebar and its collapse button) and
`src/app/MobileInspectorToggle.tsx` (the floating toggle), and the breakpoints in
`src/App.module.css`:
- **Collapsible**: Toggle button to collapse/expand inspector on any screen size
- **Media queries**: Responsive breakpoints at 1200px, 1024px, 900px, and 640px
- **Slide-out panel**: On screens < 900px, inspector becomes a fixed slide-out panel
- **Mobile toggle**: Floating action button for mobile inspector access
- **Auto-collapse**: Left sidebar collapses automatically on small screens

## Initial state (ESCSUITE-345)

`src/app/useInspectorCollapsed.ts` owns the flag `App.tsx` hands both components:
- **Starts collapsed below the breakpoint.** When `window.matchMedia(INSPECTOR_OVERLAY_QUERY)`
  (`(max-width: 900px)`, the same query as the stylesheet's slide-out block, so exactly 900px
  counts as narrow) matches on load, the inspector starts collapsed: slid out past the right
  edge, with the floating toggle reading "Show inspector". Wider viewports, and browsers with
  no `matchMedia`, start expanded as before.
- **Selection never opens it.** Selecting a clip below the breakpoint leaves it shut; only the
  floating toggle (or the sidebar's own collapse button) opens it.
- **Follows the breakpoint until the user toggles.** While the user has not toggled it, a resize
  across the breakpoint re-derives the flag from the media query's `change` event (collapsed when
  narrow, expanded when wide). The first toggle, from either button, records an explicit choice,
  and from then on resizes leave it alone until a reload. Nothing is persisted.

Tests: `src/app/useInspectorCollapsed.test.ts` (a `matchMedia` double), and the e2e specs
`apps/e2e/tests/responsive/artist.spec.ts` and `apps/e2e/tests/regressions/ESCSUITE-345.spec.ts`.
The responsive projects' tablet viewports (768px, iPad gen 7 at 810px) are below the breakpoint,
so tablets start collapsed too; specs that need the inspector there open it with
`openMobileInspector` (`apps/e2e/utils/artist.ts`), which `seedTextClip` also calls.
