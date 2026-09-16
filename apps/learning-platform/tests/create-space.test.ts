import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.LEARNING_CONTENT_ROOT
  delete process.env.LEARNING_SKIP_GIT_COMMIT
  vi.resetModules()
})

describe('catalog-only expansion', () => {
  it('creates a draft space directory and catalog entry without application code changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-platform-create-'))
    await mkdir(path.join(root, '.git'))
    await mkdir(path.join(root, 'docs', 'learning-platform'), { recursive: true })
    await mkdir(path.join(root, 'docs', 'learning-spaces'), { recursive: true })
    await mkdir(path.join(root, 'docs', 'agent-harness-learning'), { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{}')
    await writeFile(path.join(root, 'docs', 'learning-platform', 'catalog.yaml'), 'version: 1\nspaces: []\n')
    process.env.LEARNING_CONTENT_ROOT = root
    process.env.LEARNING_SKIP_GIT_COMMIT = '1'
    vi.resetModules()
    const { createLearningSpace } = await import('@/lib/admin-content')
    const { readCatalog } = await import('@/lib/catalog')
    const result = await createLearningSpace({
      slug: 'distributed-systems',
      title: 'Distributed Systems',
      description: 'A personal map for distributed systems concepts.',
      category: 'Systems Courses',
      tags: ['consensus', 'labs'],
      accent: 'blue',
    })
    const catalog = await readCatalog()
    const readme = await readFile(path.join(root, 'docs', 'learning-spaces', 'distributed-systems', 'README.md'), 'utf8')
    expect(result.space.status).toBe('draft')
    expect(catalog.spaces.map((space) => space.slug)).toContain('distributed-systems')
    expect(readme).toContain('# Distributed Systems')
  })
})
