Headless ARTIST render kit — see the plan; full README lands in Task 7.

## Input loading

Jobs are loaded from either a `.veditor` bundle (`loadBundle`, in `src/loaders.ts`) or a manifest
referencing local files on disk (`loadManifest`). `loadBundle` parses the whole `.veditor` JSON
file into memory and decodes each video's base64 payload in chunks to a temp file — for large
media this is more memory-hungry than necessary, so **prefer the manifest format for large
inputs**: it references source files on disk directly and never base64-encodes them.
