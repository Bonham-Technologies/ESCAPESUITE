# @escapesuite/plan

## 1.1.0

### Minor Changes

- b633d3e: Add Changesets for version and release management

  - Automated version bumping and changelog generation
  - GitHub Action creates "Version Packages" PR when changesets accumulate
  - All main apps (plan, craft, artist) version together

### Patch Changes

- 0b2af1f: Dependency cleanup and version synchronization

  - Remove unused gh-pages dependency and deploy scripts from PLAN
  - Sync @clerk/clerk-react to ^5.59.2 across all apps
  - Sync React to ^19.2.3 across all apps
  - Standardize TypeScript constraint to ~5.9.3 (patch-only updates)
