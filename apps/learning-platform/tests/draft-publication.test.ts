import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LearningSpace } from '@/lib/types'

const run = promisify(execFile)

afterEach(() => {
  delete process.env.LEARNING_REPO_ROOT
  delete process.env.LEARNING_DATA_DIR
  vi.resetModules()
})

describe('draft and publication protocol', () => {
  it('keeps drafts out of Git, detects stale bases, and publishes a fresh draft', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-platform-publish-'))
    const data = await mkdtemp(path.join(tmpdir(), 'learning-platform-publish-db-'))
    const contentRoot = path.join(root, 'docs', 'learning-spaces', 'fixture')
    await mkdir(contentRoot, { recursive: true })
    await mkdir(path.join(root, 'docs', 'agent-harness-learning'), { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{}')
    const documentPath = path.join(contentRoot, 'README.md')
    const original = '---\ntitle: Fixture\nstatus: published\n---\n# Original\n'
    await writeFile(documentPath, original)
    await run('git', ['init'], { cwd: root })
    await run('git', ['config', 'user.name', 'Learning Platform Test'], { cwd: root })
    await run('git', ['config', 'user.email', 'learning-platform-test@localhost'], { cwd: root })
    await run('git', ['add', '.'], { cwd: root })
    await run('git', ['commit', '-m', 'baseline'], { cwd: root })

    process.env.LEARNING_REPO_ROOT = root
    process.env.LEARNING_DATA_DIR = data
    vi.resetModules()
    const { getDocument } = await import('@/lib/content')
    const { publishDraft, saveDraft } = await import('@/lib/admin-content')
    const space: LearningSpace = {
      id: 'fixture-space', slug: 'fixture', title: 'Fixture', description: 'Fixture learning space',
      category: 'Tests', tags: [], contentRoot: 'docs/learning-spaces/fixture', entryDocument: 'README.md',
      status: 'published', featured: false, order: 10, createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z',
    }
    const document = await getDocument(space, 'index')
    await saveDraft(space, 'index', '# Draft\n', document!.revision, 'markdown')
    expect(await readFile(documentPath, 'utf8')).toBe(original)

    await writeFile(documentPath, original.replace('Original', 'External edit'))
    await expect(publishDraft(space, 'index', 'publish stale draft')).rejects.toThrow('原文已经变化')

    const current = await getDocument(space, 'index')
    await saveDraft(space, 'index', '# Published\n', current!.revision, 'markdown')
    const published = await publishDraft(space, 'index', 'publish fresh draft')
    expect(published.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(await readFile(documentPath, 'utf8')).toContain('# Published')
  })
})
