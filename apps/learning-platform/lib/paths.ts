import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_CATALOG_PATH = 'docs/learning-platform/catalog.yaml'
const DEFAULT_NEW_SPACE_ROOT = 'docs/learning-spaces'

function discoverDevelopmentContentRoot(): string {
  let current = process.cwd()
  while (current !== path.dirname(current)) {
    if (existsSync(/* turbopackIgnore: true */ path.join(current, 'package.json')) && existsSync(/* turbopackIgnore: true */ path.join(current, '.git'))) {
      return current
    }
    current = path.dirname(current)
  }
  throw new Error('Unable to locate a development content root; set LEARNING_CONTENT_ROOT')
}

function assertRelativePath(value: string, setting: string): string {
  if (path.isAbsolute(value)) throw new Error(`${setting} must be relative to LEARNING_CONTENT_ROOT`)
  const normalized = path.normalize(value)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${setting} escapes LEARNING_CONTENT_ROOT`)
  }
  return normalized
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export const contentRoot = process.env.LEARNING_CONTENT_ROOT
  ? path.resolve(process.env.LEARNING_CONTENT_ROOT)
  : discoverDevelopmentContentRoot()

export const catalogRelativePath = assertRelativePath(
  process.env.LEARNING_CATALOG_PATH || DEFAULT_CATALOG_PATH,
  'LEARNING_CATALOG_PATH',
)
export const newSpaceRelativeRoot = assertRelativePath(
  process.env.LEARNING_NEW_SPACES_PATH || DEFAULT_NEW_SPACE_ROOT,
  'LEARNING_NEW_SPACES_PATH',
)
export const catalogPath = path.join(contentRoot, catalogRelativePath)
export const newSpaceRoot = path.join(contentRoot, newSpaceRelativeRoot)

export function resolveContentPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error('Content paths must be relative to LEARNING_CONTENT_ROOT')
  }
  const resolved = path.resolve(contentRoot, relativePath)
  if (!isWithin(contentRoot, resolved)) {
    throw new Error('Content path escapes LEARNING_CONTENT_ROOT')
  }
  return resolved
}

export function assertAllowedContentRoot(relativePath: string): string {
  const resolved = resolveContentPath(relativePath)

  if (existsSync(/* turbopackIgnore: true */ resolved)) {
    const real = realpathSync(/* turbopackIgnore: true */ resolved)
    const realContentRoot = existsSync(/* turbopackIgnore: true */ contentRoot)
      ? realpathSync(/* turbopackIgnore: true */ contentRoot)
      : contentRoot
    if (!isWithin(realContentRoot, real)) {
      throw new Error(`Content root resolves through a disallowed symlink: ${relativePath}`)
    }
  }
  return resolved
}

function resolveGitRoot(): string {
  if (process.env.LEARNING_GIT_ROOT) return path.resolve(process.env.LEARNING_GIT_ROOT)
  if (process.env.NODE_ENV !== 'production') return discoverDevelopmentContentRoot()
  throw new Error('Git publishing is disabled; set LEARNING_GIT_ROOT to enable it')
}

export function toGitRelative(absolutePath: string): string {
  const gitRoot = resolveGitRoot()
  const resolved = path.resolve(absolutePath)
  if (!isWithin(gitRoot, resolved)) throw new Error('Publication path is outside the Git working tree')
  return path.relative(gitRoot, resolved).split(path.sep).join('/')
}

export function gitWorkingTree(): string {
  return resolveGitRoot()
}
