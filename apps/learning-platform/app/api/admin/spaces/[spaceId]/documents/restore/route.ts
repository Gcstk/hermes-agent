import { restoreDocument } from '@/lib/admin-content'
import { isAdmin } from '@/lib/auth'
import { readCatalog } from '@/lib/catalog'
import { assertSameOrigin, jsonError } from '@/lib/http'

export async function POST(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const { spaceId } = await context.params
  const payload = await request.json().catch(() => null) as { documentId?: unknown; revision?: unknown } | null
  if (!payload || typeof payload.documentId !== 'string' || typeof payload.revision !== 'string') return jsonError('恢复参数无效')
  const space = (await readCatalog()).spaces.find((item) => item.id === spaceId)
  if (!space) return jsonError('学习空间不存在', 404)
  try {
    return Response.json(await restoreDocument(space, payload.documentId, payload.revision))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '恢复失败', 409)
  }
}
