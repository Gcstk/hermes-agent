import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

const CATALOG_PATH = 'docs/learning-platform/catalog.yaml'
const NEW_SPACE_ROOT = 'docs/learning-spaces'

function discoverRepositoryRoot(): string {
  if (process.env.LEARNING_REPO_ROOT) {
    return path.resolve(process.env.LEARNING_REPO_ROOT)
  }

  let current = process.cwd()
  while (current !== path.dirname(current)) {
    if (existsSync(/* turbopackIgnore: true */ path.join(current, 'package.json')) && existsSync(/* turbopackIgnore: true */ path.join(current, '.git'))) {
      return current
    }
    current = path.dirname(current)
  }
  throw new Error('Unable to locate the Hermes repository root')
}

export const repositoryRoot = discoverRepositoryRoot()
export const catalogPath = path.join(repositoryRoot, CATALOG_PATH)
export const newSpaceRoot = path.join(repositoryRoot, NEW_SPACE_ROOT)

export function resolveRepositoryPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error('Content paths must be repository-relative')
  }
  const resolved = path.resolve(repositoryRoot, relativePath)
  const relative = path.relative(repositoryRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Content path escapes the repository')
  }
  return resolved
}

export function assertAllowedContentRoot(relativePath: string): string {
  const resolved = resolveRepositoryPath(relativePath)
  const allowedRoots = [
    path.join(repositoryRoot, 'docs', 'agent-harness-learning'),
    newSpaceRoot,
  ]
  const allowed = allowedRoots.some((root) => {
    const relative = path.relative(root, resolved)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
  if (!allowed) {
    throw new Error(`Content root is outside the learning directories: ${relativePath}`)
  }

  if (existsSync(/* turbopackIgnore: true */ resolved)) {
    const real = realpathSync(/* turbopackIgnore: true */ resolved)
    const realAllowed = allowedRoots.some((root) => {
      const existingRoot = existsSync(/* turbopackIgnore: true */ root) ? realpathSync(/* turbopackIgnore: true */ root) : root
      const relative = path.relative(existingRoot, real)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    })
    if (!realAllowed) {
      throw new Error(`Content root resolves through a disallowed symlink: ${relativePath}`)
    }
  }
  return resolved
}

export function toRepositoryRelative(absolutePath: string): string {
  return path.relative(repositoryRoot, absolutePath).split(path.sep).join('/')
}
