<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Capability Detection (`src/core/permissions.ts`)
Enhanced capability detection with detailed unavailability reasons:
- **CapabilityUnavailableReason**: `'api_not_supported'`, `'permission_denied'`, `'permission_dismissed'`, `'no_device'`, `'not_secure_context'`, `'browser_not_supported'`, `'policy_blocked'`
- **DetailedCapabilities**: Returns both boolean availability and reason/message for each capability
- **UI Integration**: Unavailable options are greyed out with explanatory tooltips
- Checks Permissions API where available for pre-emptive status detection
