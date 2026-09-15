import { updateLearningSpace, updateSpaceSchema } from '@/lib/admin-content'
import { isAdmin } from '@/lib/auth'
import { assertSameOrigin, jsonError } from '@/lib/http'

export async function PATCH(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const parsed = updateSpaceSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? '模块信息无效')
  const { spaceId } = await context.params
  try {
    return Response.json(await updateLearningSpace(spaceId, parsed.data))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '更新模块失败', 409)
  }
}
