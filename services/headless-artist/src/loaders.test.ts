import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadBundle, loadManifest } from './loaders'

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
})
