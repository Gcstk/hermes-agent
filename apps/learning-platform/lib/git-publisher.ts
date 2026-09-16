import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { gitWorkingTree, resolveContentPath, toGitRelative } from '@/lib/paths'
import type { GitRevision } from '@/lib/types'

const execFileAsync = promisify(execFile)

export function assertGitPublishingAvailable(): void {
  if (process.env.LEARNING_SKIP_GIT_COMMIT !== '1') gitWorkingTree()
}

export async function commitExact(paths: string[], message: string): Promise<string> {
  if (process.env.LEARNING_SKIP_GIT_COMMIT === '1') return 'git-disabled-for-test'
  if (paths.length === 0) throw new Error('No publication paths were provided')
  const repositoryRoot = gitWorkingTree()
  const gitPaths = paths.map((contentPath) => toGitRelative(resolveContentPath(contentPath)))
  await execFileAsync('git', ['add', '--', ...gitPaths], { cwd: repositoryRoot })
  await execFileAsync('git', ['commit', '--only', '-m', message, '--', ...gitPaths], { cwd: repositoryRoot })
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })
  return stdout.trim()
}

export async function fileHistory(path: string, limit = 30): Promise<GitRevision[]> {
  const repositoryRoot = gitWorkingTree()
  const gitPath = toGitRelative(resolveContentPath(path))
  const { stdout } = await execFileAsync('git', [
    'log', `--max-count=${limit}`, '--format=%H%x09%cI%x09%s', '--', gitPath,
  ], { cwd: repositoryRoot })
  return stdout.trim() ? stdout.trim().split('\n').map((line) => {
    const [revision, date, ...subject] = line.split('\t')
    return { revision, date, subject: subject.join('\t') }
  }) : []
}

export async function readFileAtRevision(revision: string, path: string): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/i.test(revision)) throw new Error('Invalid Git revision')
  const repositoryRoot = gitWorkingTree()
  const gitPath = toGitRelative(resolveContentPath(path))
  const { stdout } = await execFileAsync('git', ['show', `${revision}:${gitPath}`], { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}
