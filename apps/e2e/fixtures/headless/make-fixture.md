# Headless render test fixture

## source.mp4

A 1-second, 64×48 solid-red H.264/yuv420p MP4 (no audio).

Generated with:

```bash
ffmpeg -f lavfi -i color=c=red:s=64x48:d=1 -c:v libx264 -pix_fmt yuv420p -y apps/e2e/fixtures/headless/source.mp4
```

If `ffmpeg` is unavailable, commit the pre-made file already at this path.

## project.json

A minimal valid `RenderInput` payload referencing `source.mp4` as `src-0`.
All required fields from `Clip`, `Track`, `SourceVideo` (see `apps/artist/src/store/types.ts`
and `packages/shared/src/types/index.ts`) are present so the export engine does not throw.
