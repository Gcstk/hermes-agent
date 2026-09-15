import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.LEARNING_REPO_ROOT
  vi.resetModules()
})

describe('learning content path boundary', () => {
  it('rejects absolute paths and traversal outside the repository', async () => {
    const { resolveRepositoryPath } = await import('@/lib/paths')
    expect(() => resolveRepositoryPath('/tmp/content')).toThrow('repository-relative')
    expect(() => resolveRepositoryPath('../content')).toThrow('escapes the repository')
  })

  it('rejects a learning root that escapes through a symbolic link', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-platform-paths-'))
    await mkdir(path.join(root, '.git'))
    await mkdir(path.join(root, 'docs', 'learning-spaces'), { recursive: true })
    await mkdir(path.join(root, 'docs', 'agent-harness-learning'), { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{}')
    await symlink(tmpdir(), path.join(root, 'docs', 'learning-spaces', 'escape'))
    process.env.LEARNING_REPO_ROOT = root
    vi.resetModules()
    const { assertAllowedContentRoot } = await import('@/lib/paths')
    expect(() => assertAllowedContentRoot('docs/learning-spaces/escape')).toThrow('disallowed symlink')
  })
})
