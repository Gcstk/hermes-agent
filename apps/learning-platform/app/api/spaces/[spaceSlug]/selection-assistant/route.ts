import { isAdmin } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { getDocument } from '@/lib/content'
import { assertSameOrigin, jsonError } from '@/lib/http'
import { selectionAssistantRequestSchema } from '@/lib/selection-assistant'
import type { SelectionAssistantResponse } from '@/lib/types'

export async function POST(request: Request, context: { params: Promise<{ spaceSlug: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)

  const parsed = selectionAssistantRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? '选区助手参数无效')

  const { spaceSlug } = await context.params
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) return jsonError('学习空间不存在', 404)
  if (!await getDocument(space, parsed.data.documentId, { includeUnpublished: true })) {
    return jsonError('文章不存在', 404)
  }

  const response: SelectionAssistantResponse = {
    status: 'not-configured',
    action: parsed.data.action,
    message: parsed.data.action === 'translate'
      ? '翻译接口已预留，暂未接入翻译服务。'
      : '询问 AI 接口已预留，暂未接入模型服务。',
  }
  return Response.json(response, { status: 501 })
}
