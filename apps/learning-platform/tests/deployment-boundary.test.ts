import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.LEARNING_CONTENT_ROOT
  delete process.env.LEARNING_CATALOG_PATH
  delete process.env.LEARNING_NEW_SPACES_PATH
  delete process.env.LEARNING_GIT_ROOT
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('independent deployment boundary', () => {
  it('reads content from a configured directory without a repository checkout', async () => {
    const contentRoot = await mkdtemp(path.join(tmpdir(), 'learning-platform-content-'))
    await mkdir(path.join(contentRoot, 'catalog'), { recursive: true })
    await mkdir(path.join(contentRoot, 'spaces', 'fixture'), { recursive: true })
    await writeFile(path.join(contentRoot, 'catalog', 'catalog.yaml'), `version: 1
spaces:
  - id: fixture
    slug: fixture
    title: Fixture
    description: Independently mounted learning content.
    category: Tests
    tags: []
    contentRoot: spaces/fixture
    entryDocument: README.md
    status: published
    featured: false
    order: 10
    createdAt: 2026-09-16T00:00:00Z
    updatedAt: 2026-09-16T00:00:00Z
`)
    await writeFile(path.join(contentRoot, 'spaces', 'fixture', 'README.md'), '# Portable content\n')

    process.env.LEARNING_CONTENT_ROOT = contentRoot
    process.env.LEARNING_CATALOG_PATH = 'catalog/catalog.yaml'
    vi.resetModules()

    const { readCatalog } = await import('@/lib/catalog')
    const { listDocuments } = await import('@/lib/content')
    const catalog = await readCatalog()
    const documents = await listDocuments(catalog.spaces[0])

    expect(documents.map((document) => document.title)).toEqual(['Portable content'])
  })

  it('maps content paths into a separately configured Git working tree', async () => {
    const gitRoot = await mkdtemp(path.join(tmpdir(), 'learning-platform-git-root-'))
    const contentRoot = path.join(gitRoot, 'mounted-content')
    await mkdir(contentRoot)
    process.env.LEARNING_CONTENT_ROOT = contentRoot
    process.env.LEARNING_GIT_ROOT = gitRoot
    vi.resetModules()

    const { resolveContentPath, toGitRelative } = await import('@/lib/paths')
    const document = resolveContentPath('spaces/fixture/README.md')

    expect(toGitRelative(document)).toBe('mounted-content/spaces/fixture/README.md')
    expect(() => toGitRelative(path.join(gitRoot, '..', 'outside.md'))).toThrow('outside the Git working tree')
  })

  it('refuses an authoring operation before changing content when Git is unavailable', async () => {
    const contentRoot = await mkdtemp(path.join(tmpdir(), 'learning-platform-readonly-'))
    await mkdir(path.join(contentRoot, 'catalog'), { recursive: true })
    await mkdir(path.join(contentRoot, 'spaces'), { recursive: true })
    await writeFile(path.join(contentRoot, 'catalog', 'catalog.yaml'), 'version: 1\nspaces: []\n')
    vi.stubEnv('NODE_ENV', 'production')
    process.env.LEARNING_CONTENT_ROOT = contentRoot
    process.env.LEARNING_CATALOG_PATH = 'catalog/catalog.yaml'
    process.env.LEARNING_NEW_SPACES_PATH = 'spaces'
    vi.resetModules()

    const { createLearningSpace } = await import('@/lib/admin-content')
    await expect(createLearningSpace({
      slug: 'no-partial-write',
      title: 'No Partial Write',
      description: 'Authoring must fail before content is changed.',
      category: 'Tests',
      tags: [],
      accent: 'blue',
    })).rejects.toThrow('Git publishing is disabled')
    await expect(access(path.join(contentRoot, 'spaces', 'no-partial-write'))).rejects.toThrow()
  })
})
