import { updateSpaceStatus } from '@/lib/admin-content'
import { isAdmin } from '@/lib/auth'
import { assertSameOrigin, jsonError } from '@/lib/http'

export async function POST(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const { spaceId } = await context.params
  try {
    return Response.json(await updateSpaceStatus(spaceId, 'archived'))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '归档模块失败', 409)
  }
}
