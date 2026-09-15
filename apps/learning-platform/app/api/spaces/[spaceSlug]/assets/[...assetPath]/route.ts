import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { getSpace } from '@/lib/catalog'
import { jsonError } from '@/lib/http'
import { assertAllowedContentRoot } from '@/lib/paths'

const contentTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

export async function GET(_request: Request, context: { params: Promise<{ spaceSlug: string; assetPath: string[] }> }) {
  const { spaceSlug, assetPath } = await context.params
  const space = await getSpace(spaceSlug)
  if (!space) return jsonError('学习空间不存在', 404)
  const root = assertAllowedContentRoot(space.contentRoot)
  const candidate = path.resolve(root, ...assetPath)
  const relative = path.relative(root, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return jsonError('资源路径无效', 400)
  const contentType = contentTypes[path.extname(candidate).toLowerCase()]
  if (!contentType) return jsonError('资源类型不受支持', 415)
  try {
    const [resolvedRoot, resolvedAsset, metadata] = await Promise.all([realpath(root), realpath(candidate), stat(candidate)])
    const realRelative = path.relative(resolvedRoot, resolvedAsset)
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative) || !metadata.isFile()) return jsonError('资源路径无效', 400)
    if (metadata.size > 10 * 1024 * 1024) return jsonError('资源超过 10 MB 限制', 413)
    return new Response(await readFile(resolvedAsset), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return jsonError('资源不存在', 404)
  }
}
