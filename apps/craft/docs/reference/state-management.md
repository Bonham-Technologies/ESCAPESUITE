<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# State Management
- **Zustand store** (`src/store/recorderStore.ts`): Single source of truth for recorder state
- Core types defined in `src/store/types.ts`: `RecordingState`, `RecordingConfig`, `Recording`, `EnvironmentCapabilities`, `DetailedCapabilities`, `CapabilityInfo`, `Mp4Support`
- Recordings stored in shared IndexedDB with ESCAPEARTIST
