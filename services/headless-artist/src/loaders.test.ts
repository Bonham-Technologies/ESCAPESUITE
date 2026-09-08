import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadBundle, loadManifest, writeBase64ToFile } from './loaders'

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

  it('rejects a bundle with an unsupported version', async () => {
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.version = 2
    const badPath = path.join(dir, 'bad.veditor')
    await fs.writeFile(badPath, JSON.stringify(veditor))

    await expect(loadBundle(badPath, dir)).rejects.toThrow(/version/)
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
})
