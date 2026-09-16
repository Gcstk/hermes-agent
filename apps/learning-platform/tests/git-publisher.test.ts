import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

const run = promisify(execFile)

afterEach(() => {
  delete process.env.LEARNING_CONTENT_ROOT
  delete process.env.LEARNING_GIT_ROOT
  vi.resetModules()
})

describe('exact Git publication', () => {
  it('commits only the requested content path and preserves unrelated staged work', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-platform-git-'))
    await writeFile(path.join(root, 'package.json'), '{}')
    await writeFile(path.join(root, 'content.md'), 'before\n')
    await writeFile(path.join(root, 'unrelated.txt'), 'before\n')
    await run('git', ['init'], { cwd: root })
    await run('git', ['config', 'user.name', 'Learning Platform Test'], { cwd: root })
    await run('git', ['config', 'user.email', 'learning-platform-test@localhost'], { cwd: root })
    await run('git', ['add', 'content.md', 'unrelated.txt'], { cwd: root })
    await run('git', ['commit', '-m', 'baseline'], { cwd: root })
    await writeFile(path.join(root, 'content.md'), 'published\n')
    await writeFile(path.join(root, 'unrelated.txt'), 'user work\n')
    await run('git', ['add', 'unrelated.txt'], { cwd: root })

    process.env.LEARNING_CONTENT_ROOT = root
    process.env.LEARNING_GIT_ROOT = root
    vi.resetModules()
    const { commitExact } = await import('@/lib/git-publisher')
    await commitExact(['content.md'], 'publish content')

    const committed = await run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: root })
    const staged = await run('git', ['diff', '--cached', '--name-only'], { cwd: root })
    expect(committed.stdout.trim()).toBe('content.md')
    expect(staged.stdout.trim()).toBe('unrelated.txt')
  })

  it('lists file revisions newest-first and reads the selected historical content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-platform-history-'))
    await writeFile(path.join(root, 'package.json'), '{}')
    await writeFile(path.join(root, 'content.md'), 'first version\n')
    await run('git', ['init'], { cwd: root })
    await run('git', ['config', 'user.name', 'Learning Platform Test'], { cwd: root })
    await run('git', ['config', 'user.email', 'learning-platform-test@localhost'], { cwd: root })
    await run('git', ['add', 'content.md'], { cwd: root })
    await run('git', ['commit', '-m', 'first version'], { cwd: root })
    const firstRevision = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
    await writeFile(path.join(root, 'content.md'), 'second version\n')
    await run('git', ['add', 'content.md'], { cwd: root })
    await run('git', ['commit', '-m', 'second version'], { cwd: root })
    const secondRevision = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()

    process.env.LEARNING_CONTENT_ROOT = root
    process.env.LEARNING_GIT_ROOT = root
    vi.resetModules()
    const { fileHistory, readFileAtRevision } = await import('@/lib/git-publisher')

    const history = await fileHistory('content.md')
    expect(history.map((entry) => entry.revision)).toEqual([secondRevision, firstRevision])
    expect(await readFileAtRevision(firstRevision, 'content.md')).toBe('first version\n')
  })
})
