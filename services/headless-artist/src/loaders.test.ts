import { describe, it, expect, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadBundle, loadManifest, writeBase64ToFile } from './loaders'
import { V2_HEADER_PREFIX, assembleV2, v2IndexAndPayload, type V2Source } from '../test/veditorV2'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(here, '..', 'test', 'fixtures')
const manifestFixtureDir = path.join(fixturesDir, 'manifest')
const veditorFixture = path.join(fixturesDir, 'project.veditor')

const cleanupPaths: string[] = []

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const p = cleanupPaths.pop()
    if (p) await fs.rm(p, { recursive: true, force: true })
  }
})

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-test-'))
  cleanupPaths.push(dir)
  return dir
}

describe('loadManifest', () => {
  it('loads the project, source metadata, and absolute file paths', async () => {
    const job = await loadManifest(path.join(manifestFixtureDir, 'manifest.json'))
    expect(job.project.id).toBe('fixture')
    expect(job.project.timeline.clips[0].sourceVideoId).toBe('src-0')
    expect(job.sourceVideos).toEqual([
      { id: 'src-0', name: 'clip.mp4', mimeType: 'video/mp4', width: 64, height: 48, duration: 1 },
    ])
    expect(job.sourceFiles['src-0']).toBe(path.join(manifestFixtureDir, 'src-0.mp4'))
    expect(path.isAbsolute(job.sourceFiles['src-0'])).toBe(true)
    await job.cleanup()
    // sourceFiles are the customer's own files -- cleanup must not delete them
    await expect(fs.access(job.sourceFiles['src-0'])).resolves.toBeUndefined()
  })

  it('cleanup is a safe no-op and can be called twice', async () => {
    const job = await loadManifest(path.join(manifestFixtureDir, 'manifest.json'))
    await job.cleanup()
    await job.cleanup()
  })

  it('infers mimeType from the file extension when the manifest omits it', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'clip.mp4'))
    await fs.copyFile(path.join(manifestFixtureDir, 'project.json'), path.join(dir, 'project.json'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [{ id: 'src-0', file: 'clip.mp4' }],
      }),
    )

    const job = await loadManifest(path.join(dir, 'manifest.json'))
    expect(job.sourceVideos[0].mimeType).toBe('video/mp4')
    await job.cleanup()
  })

  it('accepts an inline project object instead of a $ref', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    const projectRef = JSON.parse(await fs.readFile(path.join(manifestFixtureDir, 'project.json'), 'utf8'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: projectRef.project,
        sources: [{ id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' }],
      }),
    )

    const job = await loadManifest(path.join(dir, 'manifest.json'))
    expect(job.project.id).toBe('fixture')
    await job.cleanup()
  })

  it('throws naming the file when a source references a missing file', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'project.json'), path.join(dir, 'project.json'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [{ id: 'src-0', file: 'missing.mp4', mimeType: 'video/mp4' }],
      }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(/missing\.mp4/)
  })

  it('throws on an unknown extension with no mimeType supplied', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'project.json'), path.join(dir, 'project.json'))
    await fs.writeFile(path.join(dir, 'clip.xyz'), 'not a real media file')
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [{ id: 'src-0', file: 'clip.xyz' }],
      }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(/clip\.xyz/)
  })

  it('throws on a source file with no extension and no mimeType supplied', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'project.json'), path.join(dir, 'project.json'))
    await fs.writeFile(path.join(dir, 'clip'), 'not a real media file')
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [{ id: 'src-0', file: 'clip' }],
      }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(
      'could not infer a MIME type for "clip"; add "mimeType" to its entry in the manifest',
    )
  })

  it('throws on duplicate basenames among sources', async () => {
    const dir = await makeTempDir()
    await fs.mkdir(path.join(dir, 'a'))
    await fs.mkdir(path.join(dir, 'b'))
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'a', 'clip.mp4'))
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'b', 'clip.mp4'))
    const projectRef = JSON.parse(await fs.readFile(path.join(manifestFixtureDir, 'project.json'), 'utf8'))
    const project = projectRef.project
    // second clip referencing the second source, so both sources are legitimately used
    project.timeline.clips.push({
      ...project.timeline.clips[0],
      id: 'clip-1',
      sourceVideoId: 'src-1',
    })
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [
          { id: 'src-0', file: 'a/clip.mp4', mimeType: 'video/mp4' },
          { id: 'src-1', file: 'b/clip.mp4', mimeType: 'video/mp4' },
        ],
      }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(/clip\.mp4/)
  })

  it('throws naming the clip and source id when a clip references an unknown source', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    const projectRef = JSON.parse(await fs.readFile(path.join(manifestFixtureDir, 'project.json'), 'utf8'))
    const project = projectRef.project
    project.timeline.clips[0].sourceVideoId = 'does-not-exist'
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [{ id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' }],
      }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(
      /clip-0.*does-not-exist|does-not-exist.*clip-0/,
    )
  })

  it('does not validate a non-overlay clip that has an empty sourceVideoId', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    const projectRef = JSON.parse(await fs.readFile(path.join(manifestFixtureDir, 'project.json'), 'utf8'))
    const project = projectRef.project
    // Not an overlay (no overlayType) but also not pointing at any source -- must be skipped,
    // not treated as an unresolved reference.
    project.timeline.clips.push({
      ...project.timeline.clips[0],
      id: 'clip-empty',
      sourceVideoId: '',
    })
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [{ id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' }],
      }),
    )

    const job = await loadManifest(path.join(dir, 'manifest.json'))
    expect(job.project.timeline.clips.some((clip) => clip.id === 'clip-empty')).toBe(true)
    await job.cleanup()
  })

  // ESCSUITE-192 (hunt-j J-5): project.timeline.clips was read with no shape check, so a
  // manifest whose project has no "timeline" at all leaked a bare TypeError ("Cannot read
  // properties of undefined (reading 'clips')") instead of naming the field, the way every
  // neighbouring validation failure does.
  it('names the field, rather than leaking a TypeError, when the project has no timeline', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { id: 'no-timeline-here' },
        sources: [{ id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' }],
      }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(
      /project\.timeline must be an object with an array "clips"/,
    )
  })

  it('names the field when project.timeline.clips is present but not an array', async () => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { id: 'bad-clips', timeline: { clips: 'nope' } },
        sources: [{ id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' }],
      }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(
      /project\.timeline must be an object with an array "clips"/,
    )
  })
  // ESCSUITE-294: a clip that is not an object leaked a bare TypeError from
  // validateClipReferences ("Cannot read properties of null (reading 'overlayType')").
  it.each([
    ['null', null],
    ['a number', 7],
    ['a list', []],
  ])('names the index, rather than leaking a TypeError, when a clip is %s', async (_label, badClip) => {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    const { project } = JSON.parse(await fs.readFile(path.join(manifestFixtureDir, 'project.json'), 'utf8'))
    project.timeline.clips.push(badClip)
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ project, sources: [{ id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' }] }),
    )

    await expect(loadManifest(path.join(dir, 'manifest.json'))).rejects.toThrow(
      'project.timeline.clips[1] must be an object',
    )
  })
})

describe('loadManifest "meta"', () => {
  // ESCSUITE-158: a manifest source had no way to say it is audio-only, so an ESCAPECRAFT
  // take recorded with no picture -- typed "video/webm;codecs=vp9,opus" even though it has
  // none -- was re-derived as video from its MIME type alone and both exporters built a frame
  // source over a file with nothing to show. `meta` mirrors the bundle's, validated the same
  // way (`assertSourceMeta`, shared with `loadBundle`).
  async function writeManifestWithMeta(meta: unknown): Promise<string> {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'project.json'), path.join(dir, 'project.json'))
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    const source: Record<string, unknown> = { id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' }
    if (meta !== undefined) source.meta = meta
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ project: { $ref: './project.json' }, sources: [source] }),
    )
    return path.join(dir, 'manifest.json')
  }

  it('forwards a source\'s "meta.mediaType" into sourceVideos, so an audio-only file keeps mediaType "audio"', async () => {
    const manifestPath = await writeManifestWithMeta({ mediaType: 'audio' })

    const job = await loadManifest(manifestPath)
    expect(job.sourceVideos[0]).toEqual({
      id: 'src-0',
      name: 'src-0.mp4',
      mimeType: 'video/mp4',
      mediaType: 'audio',
    })
    await job.cleanup()
  })

  it('leaves sourceVideos exactly as before when a source carries no "meta"', async () => {
    const manifestPath = await writeManifestWithMeta(undefined)

    const job = await loadManifest(manifestPath)
    expect(job.sourceVideos[0]).toEqual({ id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' })
    await job.cleanup()
  })

  it('rejects a non-object "meta" field, the same rejection shape the bundle gives', async () => {
    const manifestPath = await writeManifestWithMeta('not-an-object')

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      'manifest source "src-0" field "meta" must be an object',
    )
  })

  it('rejects a "meta.mediaType" that is not video, image or audio', async () => {
    const manifestPath = await writeManifestWithMeta({ mediaType: 'bogus' })

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      'manifest source "src-0" field "meta.mediaType" must be one of video, image, audio',
    )
  })

  it.each(['width', 'height'])('rejects an unusable "meta.%s"', async (field) => {
    const manifestPath = await writeManifestWithMeta({ [field]: -5 })

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `manifest source "src-0" field "meta.${field}" must be a finite number >= 0`,
    )
  })

  it('rejects a non-positive "meta.duration"', async () => {
    const manifestPath = await writeManifestWithMeta({ duration: 0 })

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      'manifest source "src-0" field "meta.duration" must be a finite positive number',
    )
  })

  it('forwards a valid "meta.duration" into sourceVideos', async () => {
    // MAJOR 1 (review round 1): the accepting arm of isUsableDuration inside "meta" was never
    // exercised -- every prior test either omitted duration or passed the rejected 0.
    const manifestPath = await writeManifestWithMeta({ duration: 2.5 })

    const job = await loadManifest(manifestPath)
    expect(job.sourceVideos[0].duration).toBe(2.5)
    await job.cleanup()
  })

  it('applies "meta" width/height/duration when there is no competing top-level value', async () => {
    // The complementary direction to "still applies the explicit top-level ... over a differing
    // meta" below: with no top-level width/height/duration at all, meta's own values land.
    const manifestPath = await writeManifestWithMeta({ mediaType: 'audio', width: 10, height: 20, duration: 3 })

    const job = await loadManifest(manifestPath)
    expect(job.sourceVideos[0]).toEqual({
      id: 'src-0',
      name: 'src-0.mp4',
      mimeType: 'video/mp4',
      mediaType: 'audio',
      width: 10,
      height: 20,
      duration: 3,
    })
    await job.cleanup()
  })

  it('still applies the explicit top-level width/height/duration over a differing "meta"', async () => {
    // The top-level fields predate "meta" and are the author's explicit, more specific word --
    // "meta" is spread first so it never clobbers them, mirroring loadBundle's own
    // `{ ...video.meta, id, name, mimeType }` ordering.
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'project.json'), path.join(dir, 'project.json'))
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [
          {
            id: 'src-0',
            file: 'src-0.mp4',
            mimeType: 'video/mp4',
            width: 1920,
            meta: { mediaType: 'audio', width: 100 },
          },
        ],
      }),
    )

    const job = await loadManifest(path.join(dir, 'manifest.json'))
    expect(job.sourceVideos[0]).toEqual({
      id: 'src-0',
      name: 'src-0.mp4',
      mimeType: 'video/mp4',
      mediaType: 'audio',
      width: 1920,
    })
    await job.cleanup()
  })
})

describe('writeBase64ToFile', () => {
  it('rejects rather than crashing when the destination cannot be written', async () => {
    const dir = await makeTempDir()
    const destPath = path.join(dir, 'no-such-parent-dir', 'out.bin')
    await expect(writeBase64ToFile('AAAA', destPath)).rejects.toThrow()
  })

  it('rejects a chunkChars that is not a positive multiple of 4', async () => {
    const dir = await makeTempDir()
    const destPath = path.join(dir, 'out.bin')
    await expect(writeBase64ToFile('AAAA', destPath, 6)).rejects.toThrow(/multiple of 4/)
    await expect(writeBase64ToFile('AAAA', destPath, 0)).rejects.toThrow(/multiple of 4/)
    await expect(writeBase64ToFile('AAAA', destPath, -4)).rejects.toThrow(/multiple of 4/)
  })

  it('decodes correctly across several chunks, including a partial final chunk with padding', async () => {
    const dir = await makeTempDir()
    // 56 bytes -> not a multiple of 3, so the base64 form ends in "=" padding.
    const original = Buffer.from(Array.from({ length: 56 }, (_, i) => i % 256))
    const base64 = original.toString('base64')
    expect(base64.endsWith('=')).toBe(true)

    const destPath = path.join(dir, 'padded.bin')
    // 12 base64 chars per chunk does not evenly divide the payload, forcing a shorter final chunk.
    await writeBase64ToFile(base64, destPath, 12)

    const written = await fs.readFile(destPath)
    expect(written.equals(original)).toBe(true)
  })

  it('decodes correctly when the payload divides evenly into several full chunks', async () => {
    const dir = await makeTempDir()
    // 9 bytes -> a multiple of 3, so the base64 form has no padding.
    const original = Buffer.from('123456789', 'utf8')
    const base64 = original.toString('base64')
    expect(base64.endsWith('=')).toBe(false)

    const destPath = path.join(dir, 'unpadded.bin')
    await writeBase64ToFile(base64, destPath, 4) // 3 chunks of exactly 4 chars each

    const written = await fs.readFile(destPath)
    expect(written.equals(original)).toBe(true)
  })
})

describe('loadBundle', () => {
  it('loads the project, decodes each video to a temp file, and reports absolute paths', async () => {
    const tmpRoot = await makeTempDir()
    const job = await loadBundle(veditorFixture, tmpRoot)
    cleanupPaths.push(...[]) // job.cleanup handles its own temp dir

    expect(job.project.id).toBe('fixture')
    expect(job.sourceVideos).toEqual([{ id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' }])

    const filePath = job.sourceFiles['src-0']
    expect(path.isAbsolute(filePath)).toBe(true)
    expect(path.basename(filePath)).toBe('src-0.mp4')

    const written = await fs.readFile(filePath)
    const original = await fs.readFile(path.join(manifestFixtureDir, 'src-0.mp4'))
    expect(written.equals(original)).toBe(true)

    await job.cleanup()
    await expect(fs.access(filePath)).rejects.toThrow()

    // safe to call twice
    await job.cleanup()
  })

  it('uses the default tmpRoot when none is given', async () => {
    const job = await loadBundle(veditorFixture)
    expect(await fs.access(job.sourceFiles['src-0'])).toBeUndefined()
    await job.cleanup()
  })

  it('rejects a JSON bundle with a version above 1, naming both versions it does read', async () => {
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.version = 2
    const badPath = path.join(dir, 'bad.veditor')
    await fs.writeFile(badPath, JSON.stringify(veditor))

    await expect(loadBundle(badPath, dir)).rejects.toThrow(
      `bundle "${badPath}" has version 2, but this build supports versions 1 and 2 (version 2 is the binary container, not JSON)`,
    )
  })

  it('throws naming the clip and source id when a clip references an unknown source', async () => {
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.project.timeline.clips[0].sourceVideoId = 'does-not-exist'
    const badPath = path.join(dir, 'bad.veditor')
    await fs.writeFile(badPath, JSON.stringify(veditor))

    await expect(loadBundle(badPath, dir)).rejects.toThrow(
      /clip-0.*does-not-exist|does-not-exist.*clip-0/,
    )
  })

  // ESCSUITE-192 (hunt-j J-5): same shape check as loadManifest's -- a bundle whose project
  // has no "timeline" at all must name the field rather than leak a bare TypeError.
  it('names the field, rather than leaking a TypeError, when the project has no timeline', async () => {
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    delete veditor.project.timeline
    const badPath = path.join(dir, 'bad.veditor')
    await fs.writeFile(badPath, JSON.stringify(veditor))

    await expect(loadBundle(badPath, dir)).rejects.toThrow(
      /project\.timeline must be an object with an array "clips"/,
    )

    // No temp dir should have been created -- this validation runs before mkdtemp.
    const entries = await fs.readdir(dir)
    expect(entries.filter((entry) => entry.startsWith('headless-artist-'))).toEqual([])
  })

  it('rejects a video id that would escape the temp directory', async () => {
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.videos[0].id = '../../evil'
    const badPath = path.join(dir, 'bad.veditor')
    await fs.writeFile(badPath, JSON.stringify(veditor))

    await expect(loadBundle(badPath, dir)).rejects.toThrow(/not a safe file name/)

    // No temp dir should have been created at all -- validation runs before mkdtemp.
    const entries = await fs.readdir(dir)
    expect(entries.filter((entry) => entry.startsWith('headless-artist-'))).toEqual([])
  })

  it('rejects a video with no base64 data, before any temp dir is created', async () => {
    const tmpRoot = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    delete veditor.videos[0].data
    const badPath = path.join(tmpRoot, 'bad.veditor')
    await fs.writeFile(badPath, JSON.stringify(veditor))

    await expect(loadBundle(badPath, tmpRoot)).rejects.toThrow(/data/)

    const entries = await fs.readdir(tmpRoot)
    expect(entries.filter((entry) => entry.startsWith('headless-artist-'))).toEqual([])
  })

  it('forwards a video\'s "meta" into sourceVideos, so an audio-only take keeps mediaType "audio"', async () => {
    // ESCSUITE-150: CRAFT types an audio-only take's blob "video/webm;codecs=vp9,opus" even
    // though there is no picture in it; `mediaType: 'audio'` in `meta` is the only thing that
    // says so, and the editor's own `loadProject` trusts it. The kit must agree.
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.videos[0].mimeType = 'video/webm;codecs=vp9,opus'
    veditor.videos[0].meta = { mediaType: 'audio' }
    const bundlePath = path.join(dir, 'audio-only.veditor')
    await fs.writeFile(bundlePath, JSON.stringify(veditor))

    const job = await loadBundle(bundlePath, dir)
    try {
      expect(job.sourceVideos[0]).toEqual({
        id: 'src-0',
        name: 'src-0.mp4',
        mimeType: 'video/webm;codecs=vp9,opus',
        mediaType: 'audio',
      })
    } finally {
      await job.cleanup()
    }
  })

  it('leaves sourceVideos exactly as before when a video carries no "meta"', async () => {
    const job = await loadBundle(veditorFixture)
    expect(job.sourceVideos[0].mediaType).toBeUndefined()
    await job.cleanup()
  })

  it.each([
    ['audio/webm', 'audio/webm'],
    ['video/webm with a codecs parameter', 'video/webm;codecs=vp9,opus'],
    ['a mixed-case MIME type', 'Video/WebM'],
  ])('names a temp file ending .webm for %s', async (_label, mimeType) => {
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.videos[0].mimeType = mimeType
    const bundlePath = path.join(dir, 'bundle.veditor')
    await fs.writeFile(bundlePath, JSON.stringify(veditor))

    const job = await loadBundle(bundlePath, dir)
    try {
      expect(path.extname(job.sourceFiles['src-0'])).toBe('.webm')
    } finally {
      await job.cleanup()
    }
  })
})

describe('loadManifest source validation', () => {
  /** A manifest dir with the fixture project and its one source file already copied in. */
  async function makeManifestDir(): Promise<string> {
    const dir = await makeTempDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'project.json'), path.join(dir, 'project.json'))
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'src-0.mp4'))
    return dir
  }

  async function writeManifest(dir: string, sources: unknown[]): Promise<string> {
    const manifestPath = path.join(dir, 'manifest.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ project: { $ref: './project.json' }, sources }),
    )
    return manifestPath
  }

  it('rejects a source whose file is a directory, not a regular file', async () => {
    const dir = await makeManifestDir()
    await fs.mkdir(path.join(dir, 'a-directory.mp4'))
    const manifestPath = await writeManifest(dir, [
      { id: 'src-0', file: 'a-directory.mp4', mimeType: 'video/mp4' },
    ])

    await expect(loadManifest(manifestPath)).rejects.toThrow(/is not a regular file/)
  })

  it('rejects two sources sharing one id', async () => {
    const dir = await makeManifestDir()
    await fs.copyFile(path.join(manifestFixtureDir, 'src-0.mp4'), path.join(dir, 'other.mp4'))
    const manifestPath = await writeManifest(dir, [
      { id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4' },
      { id: 'src-0', file: 'other.mp4', mimeType: 'video/mp4' },
    ])

    await expect(loadManifest(manifestPath)).rejects.toThrow('duplicate source id "src-0"')
  })
  // ESCSUITE-294: "name" and "mimeType" are optional (the file's basename and its extension
  // stand in), but one that is present must be a non-empty string -- a bundle entry's are
  // checked, and [] used to load here as a source's name.
  it.each([
    ['name', []],
    ['name', 5],
    ['name', ''],
    ['mimeType', true],
    ['mimeType', ''],
  ])('rejects a "%s" of %j, naming the field', async (field, value) => {
    const dir = await makeManifestDir()
    const manifestPath = await writeManifest(dir, [
      { id: 'src-0', file: 'src-0.mp4', mimeType: 'video/mp4', [field]: value },
    ])

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `manifest source "src-0" field "${field}" must be a non-empty string`,
    )
  })

  // Review round 1: a broker that writes null for an empty optional field (Python's None, a Go
  // nil pointer) means "absent", as it did before the guard -- the basename and the extension
  // stand in, the same way the editor treats a null legacy overlay array.
  it('treats a null "name" and a null "mimeType" as absent, falling back to the basename and the extension', async () => {
    const dir = await makeManifestDir()
    const manifestPath = await writeManifest(dir, [{ id: 'src-0', file: 'src-0.mp4', name: null, mimeType: null }])

    const job = await loadManifest(manifestPath)
    expect(job.sourceVideos[0]).toMatchObject({ name: 'src-0.mp4', mimeType: 'video/mp4' })
    await job.cleanup()
  })
})

describe('loadBundle video validation', () => {
  async function writeBundle(dir: string, videos: unknown[]): Promise<string> {
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.videos = videos
    const bundlePath = path.join(dir, 'bad.veditor')
    await fs.writeFile(bundlePath, JSON.stringify(veditor))
    return bundlePath
  }

  /** The fixture's first video, as a plain object we can break one field of at a time. */
  async function fixtureVideo(): Promise<Record<string, unknown>> {
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    return veditor.videos[0]
  }

  it('rejects a videos entry that is not an object, naming its index', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeBundle(dir, ['src-0'])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow('bundle video #0 must be an object')
  })

  it('rejects a null videos entry without crashing on a property read', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeBundle(dir, [null])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow('bundle video #0 must be an object')
  })

  it.each(['id', 'name', 'mimeType', 'data'])('rejects a video missing "%s"', async (field) => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    delete video[field]
    const bundlePath = await writeBundle(dir, [video])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle video #0 is missing "${field}"`)
  })

  it('names the offending index when a later video is the broken one', async () => {
    const dir = await makeTempDir()
    const good = await fixtureVideo()
    const broken = await fixtureVideo()
    delete broken.data
    const bundlePath = await writeBundle(dir, [good, { ...good, id: 'src-1' }, { ...broken, id: 'src-2' }])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow('bundle video #2 is missing "data"')
  })

  it('rejects a non-string field that is present', async () => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    video.mimeType = 42
    const bundlePath = await writeBundle(dir, [video])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow('bundle video #0 field "mimeType" must be a string')
  })

  it('rejects two videos sharing one id', async () => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    const bundlePath = await writeBundle(dir, [video, { ...video }])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`duplicate source id "${video.id}"`)
  })

  it('rejects a non-object "meta" field', async () => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    video.meta = 'not-an-object'
    const bundlePath = await writeBundle(dir, [video])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow('bundle video #0 field "meta" must be an object')
  })

  // MAJOR 2 (review round 1): the stricter meta checks (mediaType enum, width/height >= 0,
  // duration > 0) tightened assertVeditorVideo's old "is it a record" check, but had no
  // bundle-suite regression coverage of their own -- only the manifest suite exercised
  // assertSourceMeta's stricter arms, leaving the "bundle video #N" context string for each of
  // them unverified.
  it('rejects a "meta.mediaType" that is not video, image or audio', async () => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    video.meta = { mediaType: 'bogus' }
    const bundlePath = await writeBundle(dir, [video])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
      'bundle video #0 field "meta.mediaType" must be one of video, image, audio',
    )
  })

  it.each(['width', 'height'])('rejects an unusable "meta.%s"', async (field) => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    video.meta = { [field]: -5 }
    const bundlePath = await writeBundle(dir, [video])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
      `bundle video #0 field "meta.${field}" must be a finite number >= 0`,
    )
  })

  it('rejects a non-positive "meta.duration"', async () => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    video.meta = { duration: 0 }
    const bundlePath = await writeBundle(dir, [video])

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
      'bundle video #0 field "meta.duration" must be a finite positive number',
    )
  })

  it('accepts a "meta" with a valid mediaType, width, height and duration', async () => {
    const dir = await makeTempDir()
    const video = await fixtureVideo()
    video.meta = { mediaType: 'audio', width: 0, height: 0, duration: 2.5 }
    const bundlePath = await writeBundle(dir, [video])

    const job = await loadBundle(bundlePath, dir)
    try {
      expect(job.sourceVideos[0]).toMatchObject({
        mediaType: 'audio',
        width: 0,
        height: 0,
        duration: 2.5,
      })
    } finally {
      await job.cleanup()
    }
  })
})

describe('loadBundle malformed files', () => {
  /** Writes `content` verbatim, so the parse/shape checks can be driven with any bytes. */
  async function writeRaw(dir: string, content: string): Promise<string> {
    const bundlePath = path.join(dir, 'bundle.veditor')
    await fs.writeFile(bundlePath, content)
    return bundlePath
  }

  it('names the file it could not read', async () => {
    const dir = await makeTempDir()
    const missing = path.join(dir, 'gone.veditor')

    await expect(loadBundle(missing, dir)).rejects.toThrow(`bundle "${missing}" could not be read`)
  })

  it('names the file that is not valid JSON', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeRaw(dir, '{ "version": 1,')

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle "${bundlePath}" is not valid JSON`)
  })

  it('rejects valid JSON that is not an object', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeRaw(dir, '[1, 2, 3]')

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle "${bundlePath}" must be a JSON object`)
  })

  it('asks for an explicit "version": 1 rather than guessing at a bundle with none', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeRaw(dir, JSON.stringify({ project: {}, videos: [] }))

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle "${bundlePath}" must declare "version": 1`)
  })

  it('rejects a bundle with no project', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeRaw(dir, JSON.stringify({ version: 1, videos: [] }))

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle "${bundlePath}" is missing "project"`)
  })

  it('rejects a bundle whose videos are not an array', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeRaw(
      dir,
      JSON.stringify({ version: 1, project: { timeline: { clips: [] } }, videos: {} }),
    )

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle "${bundlePath}" is missing "videos"`)
  })
})

describe('loadBundle temp-file naming', () => {
  async function writeBundleWithVideo(dir: string, video: Record<string, unknown>): Promise<string> {
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.videos = [{ ...veditor.videos[0], ...video }]
    const bundlePath = path.join(dir, 'bundle.veditor')
    await fs.writeFile(bundlePath, JSON.stringify(veditor))
    return bundlePath
  }

  it('falls back to .bin when neither the MIME type nor the name names an extension', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeBundleWithVideo(dir, { mimeType: 'video/x-unheard-of', name: '' })

    const job = await loadBundle(bundlePath, dir)
    try {
      expect(path.extname(job.sourceFiles['src-0'])).toBe('.bin')
    } finally {
      await job.cleanup()
    }
  })

  it('falls back to .bin for a name with no extension at all', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeBundleWithVideo(dir, { mimeType: 'video/x-unheard-of', name: 'take-three' })

    const job = await loadBundle(bundlePath, dir)
    try {
      expect(path.extname(job.sourceFiles['src-0'])).toBe('.bin')
    } finally {
      await job.cleanup()
    }
  })

  it('takes the extension from the name when the MIME type is unrecognised', async () => {
    const dir = await makeTempDir()
    const bundlePath = await writeBundleWithVideo(dir, { mimeType: 'video/x-unheard-of', name: 'take-3.MP4' })

    const job = await loadBundle(bundlePath, dir)
    try {
      expect(path.basename(job.sourceFiles['src-0'])).toBe('src-0.mp4')
    } finally {
      await job.cleanup()
    }
  })

  it('removes its temp directory when a video cannot be written, rather than leaking it', async () => {
    const dir = await makeTempDir()
    // A file name component past NAME_MAX (255): the write fails after mkdtemp, which is the
    // only way into the loop's rollback. Anything else (ENOSPC, EIO) arrives there identically.
    const bundlePath = await writeBundleWithVideo(dir, {
      mimeType: 'video/x-unheard-of',
      name: `take.${'a'.repeat(300)}`,
    })

    await expect(loadBundle(bundlePath, dir)).rejects.toThrow(/ENAMETOOLONG/)

    const entries = await fs.readdir(dir)
    expect(entries.filter((entry) => entry.startsWith('headless-artist-'))).toEqual([])
  })
})

describe('loadManifest malformed files', () => {
  async function writeRaw(dir: string, content: string): Promise<string> {
    const manifestPath = path.join(dir, 'manifest.json')
    await fs.writeFile(manifestPath, content)
    return manifestPath
  }

  it('names the file it could not read', async () => {
    const dir = await makeTempDir()
    const missing = path.join(dir, 'gone.json')

    await expect(loadManifest(missing)).rejects.toThrow(`manifest "${missing}" could not be read`)
  })

  it('names the file that is not valid JSON', async () => {
    const dir = await makeTempDir()
    const manifestPath = await writeRaw(dir, 'sources: []')

    await expect(loadManifest(manifestPath)).rejects.toThrow(`manifest "${manifestPath}" is not valid JSON`)
  })

  it('rejects valid JSON that is not an object', async () => {
    const dir = await makeTempDir()
    const manifestPath = await writeRaw(dir, '"just a string"')

    await expect(loadManifest(manifestPath)).rejects.toThrow(`manifest "${manifestPath}" must be a JSON object`)
  })

  it('rejects a manifest with no project', async () => {
    const dir = await makeTempDir()
    const manifestPath = await writeRaw(dir, JSON.stringify({ sources: [] }))

    await expect(loadManifest(manifestPath)).rejects.toThrow(`manifest "${manifestPath}" is missing "project"`)
  })

  it('rejects a manifest whose sources are not an array', async () => {
    const dir = await makeTempDir()
    const manifestPath = await writeRaw(
      dir,
      JSON.stringify({ project: { timeline: { clips: [] } }, sources: { 'src-0': 'clip.mp4' } }),
    )

    await expect(loadManifest(manifestPath)).rejects.toThrow(`manifest "${manifestPath}" is missing "sources"`)
  })

  it('rejects a source entry with no id or file', async () => {
    const dir = await makeTempDir()
    const manifestPath = await writeRaw(
      dir,
      JSON.stringify({ project: { timeline: { clips: [] } }, sources: [{ id: 'src-0' }] }),
    )

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `manifest "${manifestPath}" has a source entry missing "id" or "file"`,
    )
  })
})

describe('loadManifest project $ref', () => {
  async function writeManifest(dir: string, project: unknown): Promise<string> {
    const manifestPath = path.join(dir, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify({ project, sources: [] }))
    return manifestPath
  }

  it('names the missing project file, resolved against the manifest directory', async () => {
    const dir = await makeTempDir()
    const manifestPath = await writeManifest(dir, { $ref: './project.json' })

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `references missing project file "${path.join(dir, 'project.json')}"`,
    )
  })

  it('names the project file that is not valid JSON', async () => {
    const dir = await makeTempDir()
    await fs.writeFile(path.join(dir, 'project.json'), 'not json')
    const manifestPath = await writeManifest(dir, { $ref: './project.json' })

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `project file "${path.join(dir, 'project.json')}" is not valid JSON`,
    )
  })

  it('rejects a project file whose contents are not an object', async () => {
    const dir = await makeTempDir()
    await fs.writeFile(path.join(dir, 'project.json'), '[]')
    const manifestPath = await writeManifest(dir, { $ref: './project.json' })

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `project file "${path.join(dir, 'project.json')}" does not contain a project object`,
    )
  })
})

describe('loadBundle version 2 (ESCSUITE-260)', () => {
  const sourcePath = path.join(manifestFixtureDir, 'src-0.mp4')
  const fixtureProject = async () => JSON.parse(await fs.readFile(veditorFixture, 'utf8')).project

  /** The fixture project over its own source, as a v2 index and payload, plus any `extra` sources. */
  async function fixtureV2(extra: V2Source[] = []) {
    const bytes = await fs.readFile(sourcePath)
    return v2IndexAndPayload(await fixtureProject(), [
      { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4', bytes },
      ...extra,
    ])
  }

  async function writeBundle(dir: string, bytes: Buffer): Promise<string> {
    const bundlePath = path.join(dir, 'bundle.veditor')
    await fs.writeFile(bundlePath, bytes)
    return bundlePath
  }

  const videosOf = (index: Record<string, unknown>) => index.videos as Record<string, unknown>[]

  async function expectNoTempDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir)
    expect(entries.filter((entry) => entry.startsWith('headless-artist-'))).toEqual([])
  }

  it('reads the 16-byte header both packages pin, spelled out byte by byte', async () => {
    const dir = await makeTempDir()
    const { index, payload } = await fixtureV2()
    const indexBytes = Buffer.from(JSON.stringify(index))
    const length = Buffer.alloc(4)
    length.writeUInt32LE(indexBytes.length)
    const header = Buffer.from([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a, 0x02, 0x00, 0x00, 0x00])
    expect([...header]).toEqual([...V2_HEADER_PREFIX])

    const job = await loadBundle(await writeBundle(dir, Buffer.concat([header, length, indexBytes, payload])), dir)
    try {
      expect(job.project.id).toBe('fixture')
      expect(job.sourceVideos).toEqual([{ id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' }])
      expect((await fs.readFile(job.sourceFiles['src-0'])).equals(await fs.readFile(sourcePath))).toBe(true)
    } finally {
      await job.cleanup()
    }
  })

  // Review Focus 5.
  it('copies each source byte for byte, forwards meta, and does not copy thumbnails', async () => {
    const dir = await makeTempDir()
    const { index, payload } = await fixtureV2([
      {
        id: 'src-1',
        name: 'mic.webm',
        mimeType: 'video/webm;codecs=opus',
        bytes: Buffer.from('the second source'),
        meta: { mediaType: 'audio', width: 0, height: 0 },
        thumbnail: { bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' },
      },
    ])

    const job = await loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)
    try {
      expect(job.sourceVideos).toEqual([
        { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' },
        { mediaType: 'audio', width: 0, height: 0, id: 'src-1', name: 'mic.webm', mimeType: 'video/webm;codecs=opus' },
      ])
      expect((await fs.readFile(job.sourceFiles['src-0'])).equals(await fs.readFile(sourcePath))).toBe(true)
      expect((await fs.readFile(job.sourceFiles['src-1'])).toString()).toBe('the second source')
      expect((await fs.readdir(path.dirname(job.sourceFiles['src-0']))).sort()).toEqual(['src-0.mp4', 'src-1.webm'])
    } finally {
      await job.cleanup()
    }
  })

  // Review Focus 2.
  it('writes an empty temp file for a zero-length range, and the next source is still whole', async () => {
    const dir = await makeTempDir()
    const project = await fixtureProject()
    const { index, payload } = v2IndexAndPayload(project, [
      { id: 'empty', name: 'empty.mp4', mimeType: 'video/mp4', bytes: Buffer.alloc(0) },
      { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4', bytes: await fs.readFile(sourcePath) },
    ])

    const job = await loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)
    try {
      expect((await fs.stat(job.sourceFiles.empty)).size).toBe(0)
      expect((await fs.readFile(job.sourceFiles['src-0'])).equals(await fs.readFile(sourcePath))).toBe(true)
    } finally {
      await job.cleanup()
    }
  })

  // A file cut short between the loader's stat and its copy: the stat still reports the whole
  // bundle, so the ranges tile, but the ranged read stops at the new end of the file. The copy
  // is checked against the range, rather than handing the engine a silently short source.
  it('refuses a source the file no longer holds all of when it is copied, and leaves no temp dir', async () => {
    const dir = await makeTempDir()
    const { index, payload } = await fixtureV2()
    const whole = assembleV2(index, payload)
    const bundlePath = await writeBundle(dir, whole.subarray(0, whole.length - 10))
    const realStat = fs.stat
    const stat = vi
      .spyOn(fs, 'stat')
      .mockImplementationOnce(async (file) => Object.assign(await realStat(file), { size: whole.length }))
    try {
      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
        `bundle "${bundlePath}" source "src-0" ended early: expected ${payload.length} bytes, copied ${payload.length - 10}`,
      )
      expect(stat.mock.calls[0][0]).toBe(bundlePath)
      await expectNoTempDir(dir)
    } finally {
      stat.mockRestore()
    }
  })

  it('still takes a JSON bundle down the version 1 path', async () => {
    const job = await loadBundle(veditorFixture, await makeTempDir())
    try {
      expect(job.sourceVideos).toEqual([{ id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' }])
    } finally {
      await job.cleanup()
    }
  })

  it('names a directory it could not read', async () => {
    const dir = await makeTempDir()
    await expect(loadBundle(dir, dir)).rejects.toThrow(`bundle "${dir}" could not be read`)
  })

  describe('refuses, before any temp file exists', () => {
    async function refused(build: (index: Record<string, unknown>, payload: Buffer) => Buffer, message: string) {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      const bundlePath = await writeBundle(dir, build(index, payload))
      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle "${bundlePath}" ${message}`)
      await expectNoTempDir(dir)
    }

    it('a newer container version', () =>
      refused((index, payload) => assembleV2(index, payload, { version: 3 }), 'has version 3, but this build supports versions 1 and 2'))

    // The magic alone decides the version: a file that opens with it but stops short of 16
    // bytes is a broken v2 header, not a v1 file that happens to fail JSON.parse.
    it('a file that opens with the magic and ends before its 16-byte header does', () =>
      refused(() => Buffer.from(V2_HEADER_PREFIX), 'ends before its header does'))

    it('a magic-prefixed file one byte short of a whole header', () =>
      refused(() => Buffer.concat([Buffer.from(V2_HEADER_PREFIX), Buffer.alloc(3)]), 'ends before its header does'))

    // Exactly 16 bytes is a whole header (an index length of 0), so it goes on to the index.
    it('a whole 16-byte header and nothing after it', () =>
      refused(() => assembleV2('', Buffer.alloc(0)), 'has an index that is not valid JSON'))

    it('a header naming a version no ESCAPEARTIST writes', () =>
      refused(
        (index, payload) => assembleV2(index, payload, { version: 1 }),
        'has a binary header naming version 1, which no ESCAPEARTIST writes',
      ))

    it('an index over the cap', () =>
      refused(
        (index, payload) => assembleV2(index, payload, { indexLength: 64 * 1024 * 1024 + 1 }),
        'declares a 67108865-byte index, over the 67108864-byte limit',
      ))

    it('an index exactly at the cap that runs past the end of the file', () =>
      refused((index, payload) => assembleV2(index, payload, { indexLength: 64 * 1024 * 1024 }), 'ends before its index does'))

    it('an index that is not JSON', () =>
      refused((_index, payload) => assembleV2('{oops', payload), 'has an index that is not valid JSON'))

    it('an index that is a list', () =>
      refused((_index, payload) => assembleV2([], payload), 'has an index that does not declare "version": 2'))

    it('an index of another version', () =>
      refused(
        (index, payload) => assembleV2({ ...index, version: 1 }, payload),
        'has an index that does not declare "version": 2',
      ))

    it('an index with no project', () =>
      refused((index, payload) => assembleV2({ ...index, project: undefined }, payload), 'is missing "project"'))

    it('an index whose videos are not a list', () =>
      refused((index, payload) => assembleV2({ ...index, videos: {} }, payload), 'is missing "videos"'))

    it('a 2 GiB-claimed source in a file that holds a few bytes', () =>
      refused((index, payload) => {
        videosOf(index)[0].data = { offset: 0, length: 2 ** 31 }
        return assembleV2(index, payload.subarray(0, 10))
      }, 'is truncated: it declares 2147483648 bytes of media but holds 10'))

    it('trailing bytes after the last source', () =>
      refused(
        (index, payload) => assembleV2(index, Buffer.concat([payload, Buffer.from([1, 2])])),
        'has 2 bytes after its last source',
      ))

    it('a gap before the first source', () =>
      refused((index, payload) => {
        const data = videosOf(index)[0].data as { offset: number; length: number }
        videosOf(index)[0].data = { offset: 1, length: data.length - 1 }
        return assembleV2(index, payload)
      }, 'video #0 field "data" starts at byte 1 of the media, expected 0'))

    it('an overlap', async () => {
      const dir = await makeTempDir()
      const { index, payload } = v2IndexAndPayload(await fixtureProject(), [
        { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4', bytes: await fs.readFile(sourcePath) },
        { id: 'src-1', name: 'b.mp4', mimeType: 'video/mp4', bytes: Buffer.from([1, 2, 3]) },
      ])
      const second = videosOf(index)[1].data as { offset: number; length: number }
      videosOf(index)[1].data = { offset: second.offset - 1, length: 4 }
      const bundlePath = await writeBundle(dir, assembleV2(index, payload))

      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
        `video #1 field "data" starts at byte ${second.offset - 1} of the media, expected ${second.offset}`,
      )
      await expectNoTempDir(dir)
    })

    // Review Focus 5. The fixture's source is L bytes, so its thumbnail must start at L;
    // it is declared at L + 1.
    it('a thumbnail range out of place', async () => {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      const data = videosOf(index)[0].data as { offset: number; length: number }
      videosOf(index)[0].thumbnail = { offset: data.length + 1, length: 1, mimeType: 'image/jpeg' }
      const bundlePath = await writeBundle(dir, assembleV2(index, Buffer.concat([payload, Buffer.from([0, 9])])))

      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
        `bundle "${bundlePath}" video #0 field "thumbnail" starts at byte ${data.length + 1} of the media, expected ${data.length}`,
      )
      await expectNoTempDir(dir)
    })
  })

  describe('refuses a malformed entry, naming the field', () => {
    async function refusedEntry(edit: (video: Record<string, unknown>) => void, message: string) {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      edit(videosOf(index)[0])
      const bundlePath = await writeBundle(dir, assembleV2(index, payload))
      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(message)
      await expectNoTempDir(dir)
    }

    it('an entry that is not an object', async () => {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      ;(index.videos as unknown[])[0] = null
      await expect(loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)).rejects.toThrow(
        'bundle video #0 must be an object',
      )
    })

    it('an id that is not a string', () =>
      refusedEntry((video) => (video.id = 7), 'bundle video #0 field "id" must be a string'))

    it('a missing type', () =>
      refusedEntry((video) => delete video.mimeType, 'bundle video #0 is missing "mimeType"'))

    it.each([
      ['a v1 base64 string', 'AAAA'],
      ['an offset that is not whole', { offset: 1.5, length: 3 }],
      ['a negative length', { offset: 0, length: -1 }],
    ])('a data range that is %s', (_case, data) =>
      refusedEntry(
        (video) => (video.data = data),
        'bundle video #0 field "data" must be {"offset", "length"}, each a whole number of bytes >= 0',
      ))

    it('a thumbnail that is not a byte range', () =>
      refusedEntry(
        (video) => (video.thumbnail = 'x'),
        'bundle video #0 field "thumbnail" must be {"offset", "length"}, each a whole number of bytes >= 0',
      ))

    it('a meta.mediaType that is not video, image or audio', () =>
      refusedEntry(
        (video) => (video.meta = { mediaType: 'hologram' }),
        'bundle video #0 field "meta.mediaType" must be one of video, image, audio',
      ))

    it('an id that would escape the temp directory', () =>
      refusedEntry((video) => (video.id = '../evil'), 'is not a safe file name'))

    it('a clip that references a source the bundle does not hold', () =>
      refusedEntry((video) => (video.id = 'renamed'), 'clip "clip-0" references unknown source "src-0"'))

    // ESCSUITE-294 review round 1: the null-clip refusal pinned by message on the bundle path too.
    it('a project clip that is null, naming its index', async () => {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      ;((index.project as { timeline: { clips: unknown[] } }).timeline.clips).push(null)
      await expect(loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)).rejects.toThrow(
        'project.timeline.clips[1] must be an object',
      )
      await expectNoTempDir(dir)
    })

    it('two entries under one id', async () => {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2([
        { id: 'src-0', name: 'again.mp4', mimeType: 'video/mp4', bytes: Buffer.from([1]) },
      ])
      await expect(loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)).rejects.toThrow(
        'duplicate source id "src-0"',
      )
    })
  })
})
