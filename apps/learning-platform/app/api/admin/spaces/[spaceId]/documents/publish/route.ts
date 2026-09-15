import { publishDraft } from '@/lib/admin-content'
import { isAdmin } from '@/lib/auth'
import { readCatalog } from '@/lib/catalog'
import { assertSameOrigin, jsonError } from '@/lib/http'

export async function POST(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const { spaceId } = await context.params
  const payload = await request.json().catch(() => null) as { documentId?: unknown; commitMessage?: unknown } | null
  if (!payload || typeof payload.documentId !== 'string' || typeof payload.commitMessage !== 'string') return jsonError('发布参数无效')
  const space = (await readCatalog()).spaces.find((item) => item.id === spaceId)
  if (!space) return jsonError('学习空间不存在', 404)
  try {
    return Response.json(await publishDraft(space, payload.documentId, payload.commitMessage))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '发布失败', 409)
  }
}
