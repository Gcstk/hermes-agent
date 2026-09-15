import { saveDraft } from '@/lib/admin-content'
import { isAdmin } from '@/lib/auth'
import { readCatalog } from '@/lib/catalog'
import { getDocument } from '@/lib/content'
import { getDatabase } from '@/lib/db'
import { assertSameOrigin, jsonError } from '@/lib/http'

async function resolveSpace(spaceId: string) {
  return (await readCatalog()).spaces.find((space) => space.id === spaceId) ?? null
}

export async function GET(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  const { spaceId } = await context.params
  const documentId = new URL(request.url).searchParams.get('document')
  if (!documentId) return jsonError('缺少文章标识')
  const space = await resolveSpace(spaceId)
  if (!space) return jsonError('学习空间不存在', 404)
  const document = await getDocument(space, documentId, { includeUnpublished: true })
  if (!document) return jsonError('文章不存在', 404)
  const draft = getDatabase().prepare('SELECT source, base_revision, format, updated_at FROM document_drafts WHERE space_id = ? AND document_id = ?').get(spaceId, documentId)
  return Response.json({ document, draft: draft ?? null })
}

export async function PUT(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const { spaceId } = await context.params
  const payload = await request.json().catch(() => null) as { documentId?: unknown; source?: unknown; baseRevision?: unknown; format?: unknown } | null
  if (!payload || typeof payload.documentId !== 'string' || typeof payload.source !== 'string' || typeof payload.baseRevision !== 'string' || typeof payload.format !== 'string') {
    return jsonError('草稿内容无效')
  }
  const space = await resolveSpace(spaceId)
  if (!space) return jsonError('学习空间不存在', 404)
  try {
    await saveDraft(space, payload.documentId, payload.source, payload.baseRevision, payload.format)
    return Response.json({ ok: true, updatedAt: new Date().toISOString() })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '保存草稿失败', 409)
  }
}
