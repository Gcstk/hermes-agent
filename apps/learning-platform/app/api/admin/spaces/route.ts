import { createLearningSpace, createSpaceSchema } from '@/lib/admin-content'
import { isAdmin } from '@/lib/auth'
import { assertSameOrigin, jsonError } from '@/lib/http'

export async function POST(request: Request) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const parsed = createSpaceSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? '模块信息无效')
  try {
    return Response.json(await createLearningSpace(parsed.data), { status: 201 })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '创建模块失败', 409)
  }
}
