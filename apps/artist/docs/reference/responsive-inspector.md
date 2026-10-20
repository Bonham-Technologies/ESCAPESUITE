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
