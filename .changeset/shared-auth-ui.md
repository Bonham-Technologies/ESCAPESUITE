---
"@escapesuite/shared": minor
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract auth UI components (AuthGate, ErrorScreen, LoadingScreen) to shared package

- Move AuthGate, ErrorScreen, LoadingScreen components to @escapesuite/shared/auth
- AuthGate now accepts appName, logo, and product props for customization
- LoadingScreen accepts appName and logo props for app-specific branding
- Apps use thin wrapper components that provide app-specific defaults
- Removes ~240 lines of duplicated code across craft and artist
